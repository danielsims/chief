import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import test from "node:test";

import { localStoreFixture } from "./local-store-test-fixture.js";

void test("diagnostics are workspace scoped, redacted, capped, and leveled", async () => {
  const { directory, store } = localStoreFixture("diagnostics");
  try {
    await store.createChat({
      id: "diagnostic-session",
      organizationId: "workspace-a",
      visibility: "user",
      agent: "chief",
      provider: "codex",
      lastText: "Useful context authorization=last-text-secret",
      summary: "Useful summary Bearer summary-secret",
      error: "Useful error token=error-secret",
    });
    await store.createChat({
      id: "other-session",
      organizationId: "workspace-b",
      visibility: "user",
      agent: "chief",
      provider: "codex",
    });
    await store.saveDiagnosticEvent("workspace-a", "diagnostic-session", 0, {
      type: "permission",
      requestId: "permission-1",
      toolName: "analytics.read",
      input: {
        authorization: "Bearer private",
        nested: { apiKey: "also-private" },
      },
    });
    await store.saveDiagnosticEvent("workspace-a", "diagnostic-session", 1, {
      type: "message",
      role: "user",
      content: [{ type: "text", text: "x".repeat(70_000) }],
    });
    await store.saveDiagnosticEvent("workspace-a", "diagnostic-session", 2, {
      type: "error",
      message: "failed",
    });
    await store.saveDiagnosticEvent("workspace-a", "diagnostic-session", 3, {
      type: "stream",
      text: [
        "Useful diagnostic text",
        "Authorization: Bearer bearer-secret",
        "https://example.test/path?token=query-secret&view=useful",
        '{"apiKey":"json-secret"}',
        "client_secret=assignment-secret",
        "github_pat_1234567890abcdef vcp_1234567890abcdefghijklmnop",
        "sk-proj-1234567890abcdef",
      ].join(" "),
    });

    const diagnostics = await store.diagnostics("workspace-a");
    assert.deepEqual(
      diagnostics.sessions.map((session) => session.id),
      ["diagnostic-session"],
    );
    assert.deepEqual(
      diagnostics.events.map((event) => event.level),
      ["warn", "info", "error", "debug"],
    );
    const redacted = JSON.stringify(diagnostics.events[0]?.data);
    assert.ok(!redacted.includes("private"));
    assert.equal(redacted.match(/\[REDACTED\]/g)?.length, 2);
    const capped = JSON.stringify(diagnostics.events[1]?.data);
    assert.ok(Buffer.byteLength(capped, "utf8") <= 64 * 1024);
    assert.match(capped, /"truncated":true/);
    const arbitrary = JSON.stringify(diagnostics.events[3]?.data);
    assert.match(arbitrary, /Useful diagnostic text/);
    assert.match(arbitrary, /view=useful/);
    for (const secret of [
      "bearer-secret",
      "query-secret",
      "json-secret",
      "assignment-secret",
      "1234567890abcdef",
    ]) {
      assert.ok(!arbitrary.includes(secret), `${secret} was redacted`);
    }
    const diagnosticSession = diagnostics.sessions[0];
    assert.ok(diagnosticSession);
    assert.match(diagnosticSession.lastText ?? "", /Useful context/);
    assert.match(diagnosticSession.summary ?? "", /Useful summary/);
    assert.match(diagnosticSession.error ?? "", /Useful error/);
    assert.ok(!JSON.stringify(diagnosticSession).includes("secret"));
    assert.deepEqual(await store.diagnostics("missing-workspace"), {
      sessions: [],
      events: [],
    });
    await assert.rejects(
      store.saveDiagnosticEvent("workspace-b", "diagnostic-session", 3, {
        type: "stream",
        text: "wrong workspace",
      }),
      /not found in this workspace/,
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
