import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalStore } from "../src/local-store.js";
import { SessionManager } from "../src/manager.js";
import { AgentSession } from "../src/session.js";
import { runSpecialistDelegation } from "../src/specialist-delegation.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-runtime-integration-test-encryption-key";

void test("the Getting started channel uses initial-review delegation rules", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-getting-started-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const manager = new SessionManager(store);
  const originalStart = Object.getOwnPropertyDescriptor(
    AgentSession.prototype,
    "start",
  );
  const originalSend = Object.getOwnPropertyDescriptor(
    AgentSession.prototype,
    "sendPrompt",
  );
  let prompt = "";
  Object.defineProperty(AgentSession.prototype, "start", {
    configurable: true,
    value: () => Promise.resolve(),
  });
  Object.defineProperty(AgentSession.prototype, "sendPrompt", {
    configurable: true,
    value(this: AgentSession, text: string) {
      prompt = this.agent.instructions;
      this.recordUserMessage(text);
      queueMicrotask(() => {
        this.recordAssistantMessage(
          "# Working brand profile\n\nA complete evidence-backed profile that is deliberately longer than one hundred characters so the runtime persists it.",
        );
        this.events.push({ type: "result", ok: true });
        this.emit("event", { type: "result", ok: true });
      });
      return Promise.resolve();
    },
  });
  try {
    await manager.createRootChat(
      "workspace",
      "getting-started",
      "Getting started",
      "codex",
    );
    const result = await runSpecialistDelegation({
      manager,
      workspaceId: "workspace",
      conversationId: "getting-started",
      delegationId: "brand-onboarding",
      agentId: "brand",
      title: "Research the brand",
      task: "Return the working profile.",
      timeoutMs: 2_000,
    });

    assert.equal(result.status, "completed");
    assert.match(
      prompt,
      /runtime will save your returned Markdown automatically/,
    );
    assert.doesNotMatch(
      prompt,
      /call the direct localTools\.brandProfileSave tool exactly once/,
    );
    assert.equal(result.file?.path, "brand/working-brand-profile.md");
  } finally {
    if (originalStart) {
      Object.defineProperty(AgentSession.prototype, "start", originalStart);
    }
    if (originalSend) {
      Object.defineProperty(AgentSession.prototype, "sendPrompt", originalSend);
    }
    await manager.stopAll();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
