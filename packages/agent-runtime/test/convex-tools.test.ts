import assert from "node:assert/strict";
import test from "node:test";

import { chiefTools } from "../templates/convex/convex/tools.js";

void test("Convex control-plane reads never attach a GET request body", async () => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.CHIEF_CONTROL_PLANE_API_BASE_URL;
  const originalToken = process.env.CHIEF_CONTROL_PLANE_TOKEN;
  let request: RequestInit | undefined;
  process.env.CHIEF_CONTROL_PLANE_API_BASE_URL = "https://chief.example";
  process.env.CHIEF_CONTROL_PLANE_TOKEN = "test-token";
  globalThis.fetch = (_input, init) => {
    request = init;
    return Promise.resolve(new Response(JSON.stringify({ prospects: [] })));
  };

  try {
    const controlPlane = chiefTools("test-model").chiefControlPlane;
    assert.ok(controlPlane.execute);
    await controlPlane.execute(
      { operation: "listRecords", body: {} },
      {
        abortSignal: new AbortController().signal,
        context: {},
        messages: [],
        toolCallId: "tool-call-1",
      },
    );
    assert.ok(request);
    assert.equal(request.method, "GET");
    assert.equal(request.body, undefined);
    assert.equal(new Headers(request.headers).get("content-type"), null);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined)
      delete process.env.CHIEF_CONTROL_PLANE_API_BASE_URL;
    else process.env.CHIEF_CONTROL_PLANE_API_BASE_URL = originalBase;
    if (originalToken === undefined)
      delete process.env.CHIEF_CONTROL_PLANE_TOKEN;
    else process.env.CHIEF_CONTROL_PLANE_TOKEN = originalToken;
  }
});
