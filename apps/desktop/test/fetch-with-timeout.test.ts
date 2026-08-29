import assert from "node:assert/strict";
import test from "node:test";

import { fetchWithTimeout } from "../src/lib/fetch-with-timeout";

void test("settles when a native fetch ignores its abort signal", async () => {
  let aborted = false;
  const fetcher = (_input: RequestInfo | URL, init?: RequestInit) => {
    init?.signal?.addEventListener("abort", () => {
      aborted = true;
    });
    return new Promise<Response>(() => undefined);
  };

  await assert.rejects(
    fetchWithTimeout(fetcher, "https://relay.example.com", {}, 5),
    (error: Error) =>
      error instanceof DOMException && error.name === "TimeoutError",
  );
  assert.equal(aborted, true);
});
