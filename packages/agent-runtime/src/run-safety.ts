import type { AgentEvent } from "./types.js";

export function hasPotentialSideEffects(events: readonly AgentEvent[]) {
  return events.some(
    (event) =>
      event.type === "toolProgress" ||
      (event.type === "permissionResolved" && event.behavior === "allow") ||
      (event.type === "message" &&
        event.content.some((block) => block.type === "tool_use")),
  );
}
