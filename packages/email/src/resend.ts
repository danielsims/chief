import { z } from "zod";

const RESEND_API_BASE = "https://api.resend.com";

export interface ResendEmailAddress {
  email: string;
  name?: string;
}

export interface ResendEmailInput {
  from: ResendEmailAddress;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
}

const resendResponseSchema = z.object({ id: z.string() });

const resendErrorSchema = z.object({
  message: z.string().optional(),
  name: z.string().optional(),
  statusCode: z.number().optional(),
});

export class ResendEmailError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ResendEmailError";
    this.status = status;
  }
}

/** Resend's transactional API, usable from Workers with plain `fetch`. */
export function createResendEmailClient(
  options: { apiKey?: string; fetch?: typeof globalThis.fetch } = {},
) {
  const apiKey = options.apiKey ?? process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is required to send email.");
  const request = options.fetch ?? globalThis.fetch;

  return {
    async send(input: ResendEmailInput) {
      if (!input.html?.trim() && !input.text?.trim()) {
        throw new Error(
          "At least one non-empty html or text body is required.",
        );
      }
      const response = await request(`${RESEND_API_BASE}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        // JSON.stringify drops undefined fields, so unset bodies are omitted.
        body: JSON.stringify({
          from: input.from.name
            ? `${input.from.name} <${input.from.email}>`
            : input.from.email,
          to: Array.isArray(input.to) ? input.to : [input.to],
          subject: input.subject,
          html: input.html,
          text: input.text,
          reply_to: input.replyTo,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const parsed = resendErrorSchema.safeParse(payload);
        throw new ResendEmailError(
          response.status,
          parsed.success && parsed.data.message
            ? parsed.data.message
            : `Resend returned HTTP ${response.status}.`,
        );
      }
      return resendResponseSchema.parse(payload);
    },
  };
}
