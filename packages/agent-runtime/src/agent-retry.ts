import type { AgentEvent } from "./types.js";

export const DEFAULT_AGENT_RETRY_DELAYS_MS = [
  1_000, 2_000, 4_000, 8_000,
] as const;

const TERMINAL_FAILURE =
  /\b(?:approval|cancel(?:led|ed)|cannot delegate|disabled|forbidden|invalid|interrupted|not configured|permission|sign[ -]?in|unauthori[sz]ed|unknown agent)\b/i;

/** Provider-neutral retry classification shared by root and specialist turns. */
export function retryableAgentFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return !TERMINAL_FAILURE.test(message);
}

/** Whether replaying a failed prompt could duplicate visible work or side effects. */
export function agentEventProducedOutput(event: AgentEvent) {
  return (
    (event.type === "stream" && event.text.length > 0) ||
    (event.type === "message" &&
      event.role === "assistant" &&
      event.content.length > 0) ||
    event.type === "toolProgress" ||
    event.type === "permission" ||
    event.type === "question"
  );
}

export function promptRetryDelays(value: string | undefined) {
  const parsed = Number(value ?? DEFAULT_AGENT_RETRY_DELAYS_MS.length + 1);
  const attempts =
    Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 10) : 5;
  return Array.from({ length: attempts - 1 }, (_, retryIndex) =>
    Math.min(16_000, 1_000 * 2 ** retryIndex),
  );
}
