const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Bound startup-critical HTTP requests so a stalled native transport cannot
 * leave the desktop UI in a loading state forever. A request that brings its
 * own signal sets its own bound, for calls that legitimately run long.
 */
export async function fetchWithTimeout(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  if (init.signal) return fetcher(input, init);
  const controller = new AbortController();
  let rejectTimeout: (reason: DOMException) => void = () => undefined;
  const timedOut = new Promise<Response>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const timeout = globalThis.setTimeout(() => {
    const error = new DOMException("Request timed out", "TimeoutError");
    controller.abort(error);
    rejectTimeout(error);
  }, timeoutMs);

  try {
    return await Promise.race([
      fetcher(input, { ...init, signal: controller.signal }),
      timedOut,
    ]);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
