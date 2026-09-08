import { getNextAttemptExternalAgentOutbox } from "./queries/external-agent-outbox/get-next-attempt";
import { getOldestLeaseExternalAgentOutbox } from "./queries/external-agent-outbox/get-oldest-lease";

export const EXTERNAL_DELIVERY_LEASE_MS = 60_000;

export function externalAgentOutboxDeadline(storage: DurableObjectStorage) {
  const pending = getNextAttemptExternalAgentOutbox<{
    next_attempt_at: string;
  }>(storage)[0];
  const delivering = getOldestLeaseExternalAgentOutbox<{
    delivering_since: string;
  }>(storage)[0];
  const deadlines = [
    pending ? Date.parse(pending.next_attempt_at) : undefined,
    delivering
      ? Date.parse(delivering.delivering_since) + EXTERNAL_DELIVERY_LEASE_MS
      : undefined,
  ].filter((value): value is number => value !== undefined);
  return deadlines.length ? Math.min(...deadlines) : undefined;
}
