import assert from "node:assert/strict";
import test from "node:test";

import type { AgentEvent } from "../src/types.js";
import { RemoteDriver } from "../src/drivers/remote.js";

void test("remote selects Convex, reconnects polling, and persists its cursor", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { url: string; authorization: string | null }[] = [];
  const responses = [
    new Response(JSON.stringify({ ok: true, configured: true })),
    new Response(JSON.stringify({ sessionId: "session-1" }), { status: 202 }),
    new Response(JSON.stringify({ error: "temporary" }), { status: 503 }),
    new Response(
      JSON.stringify({
        events: [
          {
            cursor: 0,
            event: { type: "init", sessionId: "session-1", model: "test" },
          },
          { cursor: 1, event: { type: "status", status: "running" } },
          { cursor: 2, event: { type: "stream", text: "Hello" } },
          {
            cursor: 3,
            event: {
              type: "message",
              role: "assistant",
              content: [{ type: "text", text: "Hello" }],
            },
          },
          { cursor: 4, event: { type: "result", ok: true } },
          { cursor: 5, event: { type: "status", status: "idle" } },
        ],
        status: "completed",
      }),
    ),
  ];
  globalThis.fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    requests.push({
      url,
      authorization: headers.get("authorization"),
    });
    const response = responses.shift();
    if (!response) throw new Error("Unexpected fetch");
    return Promise.resolve(response);
  };

  try {
    const driver = new RemoteDriver();
    const events: AgentEvent[] = [];
    let finalState: unknown;
    const completed = new Promise<void>((resolve) => {
      driver.on("event", (event: AgentEvent) => {
        events.push(event);
        if (event.type === "result") resolve();
      });
    });
    driver.on("state", (state) => {
      finalState = state;
    });
    await driver.start({
      cwd: "/tmp",
      instructions: "Chief",
      access: "guarded",
      env: {
        CHIEF_REMOTE_AGENT_TARGET: "convex",
        CHIEF_REMOTE_AGENT_URL: "https://example.convex.site",
        CHIEF_EVE_ROUTE_PASSWORD: "route-password",
      },
    });
    await driver.sendPrompt("Hello");
    await completed;
    await driver.stop();

    assert.equal(events.filter((event) => event.type === "init").length, 1);
    assert.ok(events.some((event) => event.type === "stream"));
    assert.deepEqual(finalState, {
      version: 1,
      target: "convex",
      host: "https://example.convex.site",
      sessionId: "session-1",
      cursor: 5,
      inFlight: false,
    });
    assert.ok(requests[2]);
    assert.ok(requests[3]);
    assert.match(requests[2].url, /events\?after=-1$/);
    assert.match(requests[3].url, /events\?after=-1$/);
    assert.ok(
      requests.every(({ authorization }) =>
        authorization?.startsWith("Basic "),
      ),
    );
    assert.ok(requests.every(({ url }) => !url.includes("route-password")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
