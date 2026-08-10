import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AgentEvent, MessageAttachment } from "./types.js";

export async function attachmentPromptContext(
  workingDirectory: string | undefined,
  attachments: readonly MessageAttachment[] | undefined,
) {
  if (!attachments?.length || !workingDirectory) return undefined;
  const directory = join(workingDirectory, ".message-attachments");
  await mkdir(directory, { recursive: true });
  const paths = await Promise.all(
    attachments.map(async (attachment) => {
      const extension =
        attachment.mediaType === "image/png"
          ? "png"
          : attachment.mediaType === "image/webp"
            ? "webp"
            : attachment.mediaType === "image/gif"
              ? "gif"
              : "jpg";
      const content = attachment.url.slice(attachment.url.indexOf(",") + 1);
      const digest = createHash("sha256")
        .update(content)
        .digest("hex")
        .slice(0, 20);
      const path = join(directory, `${digest}.${extension}`);
      await writeFile(path, Buffer.from(content, "base64"));
      return `${attachment.name}: ${path}`;
    }),
  );
  return `[Attached images — inspect these files with your image-reading tools before answering:\n${paths.map((path) => `- ${path}`).join("\n")}]`;
}

export async function channelThreadPromptContext(
  events: readonly AgentEvent[],
  workingDirectory: string | undefined,
  threadRootId: string,
) {
  const allMessages = events.filter(
    (event): event is Extract<AgentEvent, { type: "message" }> =>
      event.type === "message",
  );
  const rootIndex = allMessages.findIndex(
    (message) => message.id === threadRootId,
  );
  const recentChannelMessages =
    rootIndex > 0
      ? allMessages
          .slice(0, rootIndex)
          .filter((message) => !message.threadRootId)
          .slice(-8)
      : [];
  const threadMessages = allMessages
    .filter(
      (message) =>
        message.id === threadRootId || message.threadRootId === threadRootId,
    )
    .slice(-20);
  if (threadMessages.length === 0) return undefined;

  const formatMessages = async (
    messages: readonly Extract<AgentEvent, { type: "message" }>[],
  ) => {
    const lines: string[] = [];
    for (const message of messages) {
      const text = message.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n")
        .trim();
      const attachments = message.content.flatMap((block) =>
        block.type === "image"
          ? [{ name: block.name, mediaType: block.mediaType, url: block.url }]
          : [],
      );
      const imageContext = await attachmentPromptContext(
        workingDirectory,
        attachments,
      );
      const content = [text, imageContext].filter(Boolean).join("\n");
      if (content) {
        lines.push(`${message.role === "user" ? "User" : "Agent"}: ${content}`);
      }
    }
    return lines;
  };

  const [channelLines, threadLines] = await Promise.all([
    formatMessages(recentChannelMessages),
    formatMessages(threadMessages),
  ]);
  return [
    channelLines.length
      ? `[Recent shared channel context before this thread:\n${channelLines.join("\n\n")}]`
      : undefined,
    threadLines.length
      ? `[Current channel thread context:\n${threadLines.join("\n\n")}]`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");
}
