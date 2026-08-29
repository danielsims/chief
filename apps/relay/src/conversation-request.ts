import { appendMessageCommandSchema } from "@chief/relay-contracts";

import { HttpError } from "./http";

export async function conversationWorkflowId(request: Request) {
  const propagated = request.headers.get("x-chief-workflow-id")?.trim();
  if (propagated) return propagated;
  if (request.method !== "POST") return undefined;
  const document = await request
    .clone()
    .json()
    .catch(() => undefined);
  const command = appendMessageCommandSchema.safeParse(document);
  return command.success ? command.data.payload.messageId : undefined;
}

export function parseConversationPageInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new HttpError(
      400,
      "invalid_pagination",
      "Pagination values are invalid.",
    );
  }
  return parsed;
}
