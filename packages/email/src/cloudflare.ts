const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

export interface EmailAddress {
  address: string;
  name?: string;
}

export type EmailRecipient = string | EmailAddress;
export type EmailRecipients = EmailRecipient | EmailRecipient[];

export interface EmailAttachment {
  content: string;
  filename: string;
  type: string;
  disposition: "attachment";
}

export interface InlineEmailAttachment {
  content: string;
  content_id: string;
  filename: string;
  type: string;
  disposition: "inline";
}

export interface SendEmailInput {
  from: EmailRecipient;
  subject: string;
  to?: EmailRecipients;
  cc?: EmailRecipients;
  bcc?: EmailRecipients;
  reply_to?: EmailRecipient;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
  attachments?: (EmailAttachment | InlineEmailAttachment)[];
}

export interface CloudflareEmailResult {
  delivered: string[];
  message_id: string;
  permanent_bounces: string[];
  queued: string[];
}

interface CloudflareMessage {
  code: number;
  message: string;
}

interface CloudflareEmailResponse {
  success: boolean;
  errors: CloudflareMessage[];
  messages: CloudflareMessage[];
  result: CloudflareEmailResult | null;
}

export interface CloudflareEmailClientOptions {
  accountId?: string;
  apiToken?: string;
  fetch?: typeof globalThis.fetch;
}

export class CloudflareEmailError extends Error {
  readonly status: number;
  readonly errors: CloudflareMessage[];

  constructor(status: number, errors: CloudflareMessage[]) {
    const detail = errors.map((error) => error.message).join(", ");
    super(detail || `Cloudflare Email Service returned HTTP ${status}.`);
    this.name = "CloudflareEmailError";
    this.status = status;
    this.errors = errors;
  }
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required to send email.`);
  return value;
}

function validateMessage(input: SendEmailInput) {
  if (!input.to && !input.cc && !input.bcc) {
    throw new Error("At least one to, cc, or bcc recipient is required.");
  }
  if (!input.html?.trim() && !input.text?.trim()) {
    throw new Error("At least one non-empty html or text body is required.");
  }
}

export function createCloudflareEmailClient(
  options: CloudflareEmailClientOptions = {},
) {
  const accountId = required(
    options.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID,
    "CLOUDFLARE_ACCOUNT_ID",
  );
  const apiToken = required(
    options.apiToken ?? process.env.CLOUDFLARE_EMAIL_API_TOKEN,
    "CLOUDFLARE_EMAIL_API_TOKEN",
  );
  const request = options.fetch ?? globalThis.fetch;

  return {
    async send(input: SendEmailInput): Promise<CloudflareEmailResult> {
      validateMessage(input);
      const response = await request(
        `${CLOUDFLARE_API_BASE}/accounts/${encodeURIComponent(accountId)}/email/sending/send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(input),
        },
      );

      const payload = (await response.json()) as CloudflareEmailResponse;
      if (!response.ok || !payload.success || !payload.result) {
        throw new CloudflareEmailError(response.status, payload.errors ?? []);
      }
      return payload.result;
    },
  };
}
