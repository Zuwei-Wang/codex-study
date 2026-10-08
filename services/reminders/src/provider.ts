import { z } from "zod";
export type Message = {
  to: string;
  subject: string;
  text: string;
  unsubscribeUrl?: string;
};
export interface MailProvider {
  readonly mode: "synthetic" | "resend";
  send(message: Message, key: string): Promise<string>;
  status(
    id: string,
    recipient: string,
  ): Promise<"accepted" | "delivered" | "failed">;
}
export class ProviderError extends Error {
  constructor(
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
  }
}
/** Explicitly synthetic; never opens a network connection. */
export class MockMailProvider implements MailProvider {
  readonly mode = "synthetic" as const;
  readonly messages = new Map<string, Message>();
  async send(message: Message, key: string) {
    this.messages.set(key, structuredClone(message));
    return `synthetic-${key}`;
  }
  async status(
    _id: string,
    _recipient: string,
  ): Promise<"accepted" | "delivered" | "failed"> {
    return "delivered";
  }
}
export class ResendProvider implements MailProvider {
  readonly mode = "resend" as const;
  constructor(
    private key: string,
    private from: string,
    private transport: typeof fetch = fetch,
  ) {
    z.string().min(1).parse(key);
    z.email().parse(from);
  }
  private async request(path: string, init: RequestInit = {}) {
    let response: Response;
    try {
      response = await this.transport(`https://api.resend.com${path}`, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      });
    } catch {
      throw new ProviderError(
        true,
        "Provider transport failed; outcome may be unknown",
      );
    }
    if (!response.ok)
      throw new ProviderError(
        response.status === 429 ||
          response.status >= 500 ||
          response.status === 409,
        `Provider HTTP ${response.status}`,
      );
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new ProviderError(true, "Provider returned an invalid response");
    }
  }
  async send(message: Message, key: string) {
    const result = await this.request("/emails", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.unsubscribeUrl
          ? {
              headers: {
                "List-Unsubscribe": `<${message.unsubscribeUrl}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
            }
          : {}),
      }),
    });
    const parsed = z
      .object({ id: z.string().min(1).max(200) })
      .safeParse(result);
    if (!parsed.success)
      throw new ProviderError(true, "Provider acceptance ID missing");
    return parsed.data.id;
  }
  async status(id: string, recipient: string) {
    const result = z
      .object({
        id: z.string(),
        to: z.array(z.string()),
        last_event: z.string(),
      })
      .parse(await this.request(`/emails/${encodeURIComponent(id)}`));
    if (
      result.id !== id ||
      result.to.length !== 1 ||
      result.to[0]?.toLowerCase() !== recipient.toLowerCase()
    )
      throw new ProviderError(false, "Provider receipt identity mismatch");
    if (result.last_event === "delivered") return "delivered" as const;
    if (
      ["bounced", "complained", "failed", "suppressed", "canceled"].includes(
        result.last_event,
      )
    )
      return "failed" as const;
    return "accepted" as const;
  }
}
