import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  guardedRequestHandler,
  localToolRequest,
} from "../src/http-runtime.js";

void test("GET and HEAD local-tool requests discard envelope bodies", () => {
  for (const method of ["GET", "HEAD"]) {
    const request = localToolRequest({
      origin: "http://127.0.0.1:4317",
      url: "/local-tools/prospects?limit=5",
      method,
      headers: { authorization: "Bearer token" },
      body: { sessionId: "injected-session" },
    });

    assert.equal(request.method, method);
    assert.equal(
      request.url,
      "http://127.0.0.1:4317/local-tools/prospects?limit=5",
    );
    assert.equal(request.body, null);
    assert.equal(request.headers.get("authorization"), "Bearer token");
  }
});

void test("body-capable local-tool requests preserve the injected JSON envelope", async () => {
  const request = localToolRequest({
    origin: "http://127.0.0.1:4317",
    url: "/local-tools/browser/open",
    method: "POST",
    headers: { authorization: "Bearer token" },
    body: { sessionId: "live-session", url: "https://heychief.sh" },
  });

  assert.deepEqual(await request.json(), {
    sessionId: "live-session",
    url: "https://heychief.sh",
  });
});

void test("an async request failure returns 500 without closing the server", async () => {
  const errors: unknown[] = [];
  const server = createServer(
    guardedRequestHandler(
      () => Promise.reject(new Error("bad request")),
      (error) => errors.push(error),
    ),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    for (let requestIndex = 0; requestIndex < 2; requestIndex += 1) {
      const response: Response = await fetch(
        `http://127.0.0.1:${address.port}/broken`,
      );
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), {
        error: "bad request",
        code: "local_tool_failed",
      });
    }
    assert.equal(errors.length, 2);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
