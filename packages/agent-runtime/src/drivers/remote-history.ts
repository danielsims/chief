import type { AgentEvent } from "../types.js";

export function remoteHistoryContext(
  history: AgentEvent[] | undefined,
  excludeTrailingUserText?: string,
) {
  const historyMessages = (history ?? []).filter(
    (event): event is Extract<AgentEvent, { type: "message" }> =>
      event.type === "message",
  );
  const trailing = historyMessages.at(-1);
  const trailingText = trailing?.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
  if (
    trailing?.role === "user" &&
    trailingText &&
    trailingText === excludeTrailingUserText?.trim()
  ) {
    historyMessages.pop();
  }
  const messages = historyMessages
    .slice(-30)
    .map((event) => {
      const text = event.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n")
        .trim();
      return text ? `${event.role === "user" ? "User" : "Chief"}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n")
    .slice(-20_000);
  return messages
    ? `Prior Chief conversation history imported for continuity:\n\n${messages}`
    : undefined;
}
