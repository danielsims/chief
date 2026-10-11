import { relayError } from "./http";

// Cloudflare names each exhausted allowance (duration, requests, rows read,
// rows written) in a message that ends with this phrase.
const durableObjectFreeTierMessage = "in Durable Objects free tier";

function secondsUntilNextUtcDay(now = new Date()) {
  const nextUtcDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((nextUtcDay - now.getTime()) / 1_000));
}

export function relayCapacityResponse(
  error: Error | undefined,
  requestId?: string,
): Response | undefined {
  if (!error?.message.includes(durableObjectFreeTierMessage)) return undefined;
  return relayError(
    503,
    "relay_capacity_exhausted",
    "This relay is busy right now. Try again later, or switch to another relay.",
    requestId,
    undefined,
    { "retry-after": String(secondsUntilNextUtcDay()) },
  );
}
