import { z } from "zod";

import type { ConversationMessage, JsonObject } from "@chief/relay-contracts";

export const CHANNEL_PAGE_DEFAULT = 5;
export const CHANNEL_PAGE_MAX_CHARS = 16_000;
export const CHANNEL_MESSAGE_PREVIEW_CHARS = 2_000;
const channelCursorSchema = z.union([z.string(), z.number()]);

/** Shared by hosted and relay-cell tools; never silently ignore a bad cursor. */
export function channelMessagePaging(input: JsonObject) {
  const bodyChars =
    input.bodyChars === undefined ? undefined : Number(input.bodyChars);
  if (
    bodyChars !== undefined &&
    (!Number.isSafeInteger(bodyChars) || bodyChars < 1 || bodyChars > 8000)
  )
    throw new Error(
      "bodyChars must be an integer from 1 to 8000; use a larger preview only when bodyTruncated is true.",
    );
  const limit =
    input.limit === undefined ? CHANNEL_PAGE_DEFAULT : Number(input.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error(
      "limit must be an integer from 1 to 100; omit it for the latest five messages.",
    );
  let before: number | undefined;
  if (input.cursor !== undefined) {
    const cursor = channelCursorSchema.safeParse(input.cursor);
    if (!cursor.success || !/^\d+$/u.test(String(cursor.data)))
      throw new Error(
        "cursor must be the nextSequence value from the previous page.",
      );
    before = Number(cursor.data);
    if (!Number.isSafeInteger(before) || before < 1)
      throw new Error(
        "cursor must be the positive nextSequence value from the previous page.",
      );
  }
  const paging: {
    limit: number;
    recent: true;
    bodyChars?: number;
    before?: number;
  } = {
    limit,
    recent: true,
  };
  if (bodyChars !== undefined) paging.bodyChars = bodyChars;
  if (before !== undefined) paging.before = before;
  return paging;
}

function preview(
  message: ConversationMessage,
  bodyChars = CHANNEL_MESSAGE_PREVIEW_CHARS,
) {
  return {
    id: message.id,
    sequence: message.sequence,
    author: { kind: message.author.kind, id: message.author.id },
    createdAt: message.createdAt,
    threadRootId: message.threadRootId ?? null,
    body: message.body.slice(0, bodyChars),
    bodyTruncated: message.body.length > bodyChars,
    bodyLength: message.body.length,
    // Expose useful card identifiers without repeating arbitrary card payloads,
    // embedded tool receipts, attachments or private thinking.
    components: message.components
      .filter((c) => c.kind === "artifact" || c.kind === "attachment")
      .slice(0, 4)
      .map((c) => ({ id: c.id.slice(0, 128), kind: c.kind })),
  };
}

/** Model-facing projection only. The durable messages and desktop UI stay intact.
 * The byte-size of rich activity components is independent of the message limit.
 * Page on the oldest RETURNED message when the budget stops us early: otherwise
 * the omitted messages would disappear between pages.
 */
export function compactChannelMessagePage(
  page: { messages: ConversationMessage[]; nextSequence: number | null },
  limit = CHANNEL_PAGE_DEFAULT,
  bodyChars = CHANNEL_MESSAGE_PREVIEW_CHARS,
) {
  const visible = page.messages
    .filter(
      (m) =>
        !m.deleted &&
        (m.body.trim() ||
          m.components.some(
            (c) => c.kind === "artifact" || c.kind === "attachment",
          )),
    )
    .sort((a, b) => b.sequence - a.sequence);
  const messages: ReturnType<typeof preview>[] = [];
  let budgetLimited = false;
  for (const message of visible) {
    if (messages.length >= limit) break;
    const next = preview(message, bodyChars);
    // An explicitly expanded, heavily escaped body must not make the first
    // page empty and lose its cursor. Retain a bounded preview of that message.
    if (messages.length === 0) {
      while (
        next.body.length > 0 &&
        JSON.stringify({
          nextSequence: message.sequence,
          order: "newest_first",
          budgetLimited: true,
          messages: [next],
        }).length > CHANNEL_PAGE_MAX_CHARS
      ) {
        next.body = next.body.slice(0, Math.floor(next.body.length / 2));
        next.bodyTruncated = true;
      }
    }
    // Include the complete envelope in the check, including JSON escaping.
    if (
      JSON.stringify({
        nextSequence: message.sequence,
        order: "newest_first",
        budgetLimited: true,
        messages: [...messages, next],
      }).length > CHANNEL_PAGE_MAX_CHARS
    ) {
      budgetLimited = true;
      break;
    }
    messages.push(next);
  }
  const moreInPage = messages.length < visible.length;
  const nextSequence = moreInPage
    ? (messages.at(-1)?.sequence ?? page.nextSequence)
    : page.nextSequence;
  return { nextSequence, order: "newest_first", budgetLimited, messages };
}
