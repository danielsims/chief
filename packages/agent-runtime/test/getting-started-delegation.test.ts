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

void test("mission control supplies the Marketer with durable output context", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-onboarding-"));
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
          "# Working brand profile\n\nA complete evidence-backed profile produced after using the workspace tools supplied by the active skill.",
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
      "mission-control",
      "Initial business review",
      "codex",
    );
    const result = await runSpecialistDelegation({
      manager,
      workspaceId: "workspace",
      conversationId: "mission-control",
      delegationId: "brand-onboarding",
      agentId: "brand",
      title: "Research the brand",
      task: "Return the working profile.",
      timeoutMs: 2_000,
    });

    assert.equal(result.status, "completed");
    assert.match(prompt, /localTools\.brandProfileSave/u);
    assert.match(prompt, /localTools\.filesWrite/u);
    assert.match(prompt, /existing files/u);
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
