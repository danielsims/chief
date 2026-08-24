import { isJsonNumber } from "@chief/relay-contracts";

export const relayReconnectPolicy = {
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  stableResetMs: 60_000,
} as const;

export function isTerminalSubscriptionError(error: Error) {
  const status = "status" in error ? error.status : undefined;
  return isJsonNumber(status) && [400, 401, 403, 404].includes(status);
}

export function waitForSocketOpen(socket: WebSocket) {
  if (socket.readyState === 1) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("The relay live connection could not open.")),
      { once: true },
    );
  });
}

export function asRelayError(value: unknown) {
  return value instanceof Error ? value : new Error(String(value));
}
