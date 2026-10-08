import { officialDateState, type DateValue } from "./schema.js";
import type { Snapshot } from "./workspace.js";

// Source text is data, never HTML, a link destination, or an instruction.
const escape = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]()#+.!|~-]/g, "\\$&")
    .replace(/[\r\n]/g, " ");

export function renderNavigation(snapshot: Snapshot): string {
  const zh = snapshot.config.language === "zh-CN";
  const label = (en: string, cn: string): string => (zh ? cn : en);
  const date = (value: DateValue): string => {
    if (value.precision === "unknown") return label("Unknown", "未知");
    if (value.precision === "date")
      return `${value.date} (${label("date only; no time supplied", "仅日期，未提供具体时间")})`;
    return `${new Intl.DateTimeFormat(zh ? "zh-CN" : "en-GB", {
      timeZone: snapshot.config.timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value.at))} [${snapshot.config.timeZone}] (${value.at})`;
  };
  const lines = [
    `# ${label("Study navigation", "学习导航")}`,
    "",
    `${escape(snapshot.config.academicYear)} · ${escape(snapshot.config.timeZone)}`,
    "",
    label(
      "Generated snapshot. Original files are archived without parsing. Verification describes local imports only. Progress is explicitly recorded, never inferred.",
      "生成的快照。原始文件仅归档，未解析内容；验证状态仅描述本地导入。学习进度均为明确记录，不作推断。",
    ),
    "",
  ];
  for (const course of snapshot.courses) {
    lines.push(
      `## ${escape(course.title)} (${escape(course.id)})`,
      "",
      `### ${label("Materials", "资料")}`,
      "",
    );
    for (const material of snapshot.materials.filter(
      (m) => m.source.courseId === course.id,
    )) {
      lines.push(
        `- **${escape(material.source.title)}** · ${escape(material.source.id)} · ${material.source.kind}`,
        `  - ${label("Source", "来源")}: ${escape(material.source.reference)}`,
        `  - ${label("Status", "状态")}: ${material.status}; ${label("last verified", "上次验证")}: ${material.lastVerifiedAt}; ${label("last attempt", "最近尝试")}: ${material.lastAttemptedAt}`,
        `  - ${escape(material.detail)}`,
      );
      for (const version of material.versions) {
        lines.push(
          `  - [v${version.version} · ${escape(version.filename)}](../objects/${version.hash}.${version.format})${version.hash === material.currentHash ? ` **${label("current", "当前")}**` : ""} · SHA-256: \`${version.hash}\` · ${version.bytes} bytes`,
        );
      }
      const progress = snapshot.progress.filter(
        (p) =>
          p.entity === "source" &&
          p.courseId === course.id &&
          p.id === material.source.id,
      );
      lines.push(
        `  - ${label("Recorded progress", "已记录进度")}: ${progress.map((p) => p.stage).join(", ") || label("none", "无")}`,
      );
    }
    lines.push("", `### ${label("Tasks", "任务")}`, "");
    for (const task of snapshot.tasks.filter((t) => t.courseId === course.id)) {
      lines.push(
        `- **${escape(task.title)}** · ${escape(task.id)} · ${label("source", "来源")}: ${escape(task.sourceId)}`,
        `  - ${label("Official deadline state", "官方截止日期状态")}: **${officialDateState(task)}**`,
      );
      if (!task.deadlines.length)
        lines.push(
          `  - ${label("Unknown dates; this does not mean no task.", "日期未知，不代表没有任务。")}`,
        );
      for (const deadline of task.deadlines)
        lines.push(
          `  - ${deadline.kind}: ${date(deadline.value)} — ${escape(deadline.evidence)}`,
        );
      const progress = snapshot.progress.filter(
        (p) =>
          p.entity === "task" && p.courseId === course.id && p.id === task.id,
      );
      lines.push(
        `  - ${label("Recorded progress", "已记录进度")}: ${progress.map((p) => `${p.stage} (${p.at}; ${escape(p.evidence)})`).join(", ") || label("none", "无")}`,
      );
    }
    lines.push("", `### ${label("Notes", "笔记")}`, "");
    for (const record of (snapshot.notes ?? []).filter(
      (n) => n.note.courseId === course.id,
    )) {
      lines.push(
        `- [${escape(record.note.title)}](../${record.relativePath}) · ${record.note.coverage.basis} · ${record.createdAt}`,
      );
    }
    lines.push("");
  }
  if (!snapshot.courses.length)
    lines.push(label("No courses recorded.", "尚未记录课程。"), "");
  return lines.join("\n");
}
