import { relayError } from "./http";

const durableObjectFreeTierMessage =
  "Exceeded allowed volume of requests in Durable Objects free tier";

export function relayCapacityResponse(
  error: Error | undefined,
  requestId?: string,
): Response | undefined {
  if (!error?.message.includes(durableObjectFreeTierMessage)) {
    return undefined;
  }
  return relayError(
    503,
    "relay_capacity_exhausted",
    "This relay is temporarily at capacity. Try again after its usage window resets.",
    requestId,
    undefined,
    { "retry-after": "3600" },
  );
}
