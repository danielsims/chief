import { isJsonNumber, isJsonString } from "@chief/relay-contracts";

import type { RecurringWorkRecord } from "./types.js";

export const TRANSIENT_RETRY_DELAY_MS = 30_000;

const WORK_RETRY_MESSAGE =
  "Chief is reconnecting to the local agent service and will continue this work automatically.";
const RETRY_EXHAUSTED_MESSAGE =
  "Chief's local runtime did not recover after one automatic retry. Nothing external was changed.";

function errorChain<TError>(error: TError): string {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
    } else {
      messages.push(
        isJsonString(current) || isJsonNumber(current)
          ? `${current}`
          : "Unknown runtime error",
      );
      break;
    }
  }
  return messages.join(" ");
}

export function isTransientRuntimeError<TError>(error: TError): boolean {
  return /SQLITE_BUSY|database is locked|cannot commit transaction|RPC timeout|initialize timed out|ECONNRESET|ETIMEDOUT/i.test(
    errorChain(error),
  );
}

export function isAutomaticRetrySummary(
  summary: string | null | undefined,
): boolean {
  return summary === WORK_RETRY_MESSAGE;
}

export function transientRetryOutcome<TError>(
  error: TError,
  work: Pick<RecurringWorkRecord, "lastSummary">,
) {
  const transient = isTransientRuntimeError(error);
  const isAutomaticRetry = isAutomaticRetrySummary(work.lastSummary);
  const retrying = transient && !isAutomaticRetry;
  return {
    retrying,
    message: retrying
      ? WORK_RETRY_MESSAGE
      : transient
        ? RETRY_EXHAUSTED_MESSAGE
        : null,
  };
}
