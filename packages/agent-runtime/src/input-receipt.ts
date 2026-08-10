import type { AgentEvent, InputRequest } from "./types.js";

function receiptMarker(requestId: string) {
  return `[chief-input:${requestId}]`;
}

export function hasInputReceipt(
  events: readonly AgentEvent[],
  requestId: string,
) {
  const marker = receiptMarker(requestId);
  return events.some(
    (event) =>
      event.type === "message" &&
      event.role === "user" &&
      event.content.some(
        (block) => block.type === "text" && block.text.includes(marker),
      ),
  );
}

export function inputReceipt(
  request: Pick<InputRequest, "id" | "title">,
  saved: readonly string[],
) {
  return saved.length > 0
    ? `Provided: ${request.title}. Saved to: ${saved.join(", ")}. Read the values from there when commands need them; never print them. Continue the setup. ${receiptMarker(request.id)}`
    : `Provided: ${request.title}, but no values were saved. Ask again with clearer fields if you still need them. ${receiptMarker(request.id)}`;
}
