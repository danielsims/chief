import { relayError } from "./http";

const durableObjectFreeTierMessages = [
  "Exceeded allowed duration in Durable Objects free tier",
  "Exceeded allowed volume of requests in Durable Objects free tier",
] as const;

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
  if (
    !error ||
    !durableObjectFreeTierMessages.some((message) =>
      error.message.includes(message),
    )
  ) {
    return undefined;
  }
  return relayError(
    503,
    "relay_capacity_exhausted",
    "This relay has reached Cloudflare's daily Durable Object allowance. Cloudflare resets it at 00:00 UTC, or you can switch to another relay now.",
    requestId,
    undefined,
    { "retry-after": String(secondsUntilNextUtcDay()) },
  );
}
