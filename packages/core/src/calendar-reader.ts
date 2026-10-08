import ICAL from "ical.js";
import { Temporal } from "@js-temporal/polyfill";
import { sha256 } from "./storage.js";
import type { DateValue } from "./schema.js";
import type {
  CalendarExtraction,
  CalendarImport,
  CalendarOccurrence,
} from "./calendar.js";

type Component = InstanceType<typeof ICAL.Component>;
type Time = InstanceType<typeof ICAL.Time>;
const text = (component: Component, key: string) =>
  String(component.getFirstPropertyValue(key) ?? "");

/** No URL, attachment or calendar alarm is fetched or executed. */
export function parseCalendar(
  textInput: string,
  input: CalendarImport,
): CalendarExtraction {
  const parsed = ICAL.parse(textInput);
  if (!Array.isArray(parsed) || parsed[0] !== "vcalendar")
    throw new Error("Expected one VCALENDAR");
  const calendar = new ICAL.Component(parsed);
  if (text(calendar, "version") !== "2.0")
    throw new Error("Expected iCalendar version 2.0");
  const components = calendar.getAllSubcomponents("vevent");
  if (components.length > 3000)
    throw new Error("Calendar exceeds the event limit");
  // Component-local timezone lookup avoids sharing mutable timezone registries across feeds.
  const value = (
    time: Time,
    component: Component,
    property = "dtstart",
  ): DateValue => {
    Temporal.PlainDateTime.from(
      {
        year: time.year,
        month: time.month,
        day: time.day,
        hour: time.hour,
        minute: time.minute,
        second: time.second,
      },
      { overflow: "reject" },
    );
    if (time.isDate) return { precision: "date", date: time.toString() };
    const declared = component.getFirstProperty(property)?.getParameter("tzid");
    let at: string;
    if (time.zone.tzid !== "floating" && time.zone.tzid !== "local")
      at = new Date(time.toUnixTime() * 1000).toISOString();
    else {
      const zone =
        typeof declared === "string" ? declared : input.floatingTimeZone;
      if (!zone)
        throw new Error(
          "Floating calendar time requires an explicit floatingTimeZone",
        );
      at = Temporal.ZonedDateTime.from(
        {
          timeZone: zone,
          year: time.year,
          month: time.month,
          day: time.day,
          hour: time.hour,
          minute: time.minute,
          second: time.second,
        },
        { disambiguation: "reject", overflow: "reject" },
      )
        .toInstant()
        .toString({ smallestUnit: "millisecond" });
    }
    return { precision: "instant", at };
  };
  const identity = (
    time: Time,
    component: Component,
    property = "dtstart",
  ): string => {
    const date = value(time, component, property);
    return date.precision === "date"
      ? date.date
      : date.precision === "instant"
        ? date.at
        : "";
  };
  const within = (date: DateValue) => {
    if (date.precision === "unknown") return false;
    if (date.precision === "date")
      return (
        date.date >= input.window.start.slice(0, 10) &&
        date.date < input.window.end.slice(0, 10)
      );
    return (
      Date.parse(date.at) >= Date.parse(input.window.start) &&
      Date.parse(date.at) < Date.parse(input.window.end)
    );
  };
  const seq = (component: Component) => {
    const n = component.getFirstPropertyValue("sequence") ?? 0;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0)
      throw new Error("Invalid event sequence");
    return n;
  };
  const selected = new Map<string, Component>();
  for (const component of components) {
    const uid = text(component, "uid");
    if (!uid || uid.length > 2000)
      throw new Error("Missing or invalid calendar UID");
    const recurrence = component.getFirstPropertyValue(
      "recurrence-id",
    ) as Time | null;
    if (component.getFirstProperty("recurrence-id")?.getParameter("range"))
      throw new Error(
        "RANGE recurrence exceptions are not supported; preserve the previous feed",
      );
    const key = JSON.stringify([
      uid,
      recurrence ? identity(recurrence, component, "recurrence-id") : null,
    ]);
    const prior = selected.get(key);
    if (!prior || seq(component) > seq(prior)) selected.set(key, component);
    else if (
      seq(component) === seq(prior) &&
      component.toString() !== prior.toString()
    )
      throw new Error("Conflicting duplicate event revisions");
  }
  const result: CalendarExtraction = { occurrences: [], cancellations: [] };
  const masters = [...selected.values()].filter(
    (c) => !c.hasProperty("recurrence-id"),
  );
  const exceptions = [...selected.values()].filter((c) =>
    c.hasProperty("recurrence-id"),
  );
  const output = new Map<string, CalendarOccurrence>();
  let expanded = 0;
  const emit = (
    component: Component,
    uid: string,
    recurrenceId: string | null,
    start: Time,
    end: Time,
    baseSequence = 0,
  ) => {
    const begins = value(start, component),
      ends = value(
        end,
        component,
        component.hasProperty("dtend") ? "dtend" : "dtstart",
      );
    if (begins.precision !== ends.precision)
      throw new Error("Inconsistent event date precision");
    if (
      begins.precision === "instant" &&
      ends.precision === "instant" &&
      Date.parse(ends.at) < Date.parse(begins.at)
    )
      throw new Error("Event end precedes its start");
    if (
      begins.precision === "date" &&
      ends.precision === "date" &&
      ends.date <= begins.date
    )
      throw new Error("All-day end must be exclusive and after start");
    const originalInWindow =
      recurrenceId &&
      within(
        recurrenceId.length === 10
          ? { precision: "date", date: recurrenceId }
          : { precision: "instant", at: recurrenceId },
      );
    if (!within(begins) && !originalInWindow) return;
    const id = sha256(JSON.stringify([uid, recurrenceId]));
    output.set(id, {
      id,
      uid,
      recurrenceId,
      title: text(component, "summary") || "(untitled)",
      location: text(component, "location"),
      start: begins,
      end: ends,
      sequence: Math.max(seq(component), baseSequence),
      status:
        text(component, "status").toUpperCase() === "CANCELLED"
          ? "cancelled"
          : "active",
    });
  };
  for (const component of masters) {
    const uid = text(component, "uid");
    if (
      text(component, "status").toUpperCase() === "CANCELLED" ||
      text(calendar, "method").toUpperCase() === "CANCEL"
    ) {
      result.cancellations.push({
        uid,
        recurrenceId: null,
        sequence: seq(component),
      });
      continue;
    }
    if (!component.hasProperty("dtstart"))
      throw new Error("Active calendar event has no DTSTART");
    const event = new ICAL.Event(component, { exceptions: [] });
    const related = exceptions.filter((c) => text(c, "uid") === uid);
    for (const exception of related)
      if (exception.hasProperty("dtstart")) event.relateException(exception);
    for (const rule of component.getAllProperties("rrule")) {
      const recurrence = rule.getFirstValue() as InstanceType<
        typeof ICAL.Recur
      >;
      if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(recurrence.freq))
        throw new Error(
          "Only daily, weekly, monthly or yearly recurrences are supported",
        );
    }
    for (const property of ["rdate", "exdate"])
      for (const prop of component.getAllProperties(property)) {
        if (prop.type !== "date" && prop.type !== "date-time")
          throw new Error("Period-valued recurrence dates are unsupported");
      }
    if (!event.isRecurring()) {
      emit(component, uid, null, event.startDate, event.endDate);
      continue;
    }
    const iterator = event.iterator();
    for (
      let occurrence = iterator.next();
      occurrence;
      occurrence = iterator.next()
    ) {
      if (++expanded > 20000)
        throw new Error("Calendar recurrence expansion exceeds the limit");
      const key = identity(occurrence, component);
      if (
        key.length === 10
          ? key >= input.window.end.slice(0, 10)
          : Date.parse(key) >= Date.parse(input.window.end)
      )
        break;
      const detail = event.getOccurrenceDetails(occurrence);
      emit(
        detail.item.component,
        uid,
        key,
        detail.startDate,
        detail.endDate,
        seq(component),
      );
    }
    // A moved occurrence can enter the window from an original date outside it.
    for (const exception of related)
      if (exception.hasProperty("dtstart")) {
        const e = new ICAL.Event(exception, { exceptions: [] });
        emit(
          exception,
          uid,
          identity(e.recurrenceId, exception, "recurrence-id"),
          e.startDate,
          e.endDate,
          seq(component),
        );
      }
  }
  for (const exception of exceptions) {
    const uid = text(exception, "uid");
    const recurrenceId = identity(
      exception.getFirstPropertyValue("recurrence-id") as Time,
      exception,
      "recurrence-id",
    );
    if (
      text(exception, "status").toUpperCase() === "CANCELLED" ||
      text(calendar, "method").toUpperCase() === "CANCEL"
    )
      result.cancellations.push({
        uid,
        recurrenceId,
        sequence: seq(exception),
      });
    else if (!masters.some((c) => text(c, "uid") === uid)) {
      if (!exception.hasProperty("dtstart"))
        throw new Error("Active recurrence exception has no DTSTART");
      const e = new ICAL.Event(exception, { exceptions: [] });
      emit(exception, uid, recurrenceId, e.startDate, e.endDate);
    }
  }
  result.occurrences = [...output.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  return result;
}
