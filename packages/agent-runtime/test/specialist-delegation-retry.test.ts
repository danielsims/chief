import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalStore } from "../src/local-store.js";
import { SessionManager } from "../src/manager.js";
import { AgentSession } from "../src/session.js";
import { runSpecialistDelegation } from "../src/specialist-delegation.js";
import { terminalSpecialistOutcome } from "../src/specialist-outcome-state.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-runtime-integration-test-encryption-key";

void test("a successful result wins over later process shutdown events", () => {
  assert.deepEqual(
    terminalSpecialistOutcome([
      {
        type: "message",
        role: "user",
        content: [{ type: "text", text: "Research the brand" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Completed profile" }],
      },
      { type: "result", ok: true },
      { type: "error", message: "Codex exited with code 1" },
      { type: "exit", code: 1 },
    ]),
    { status: "completed", result: "Completed profile" },
  );
});

void test("initial Brand research retries a failed private session", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-specialist-retry-"));
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
  let prompts = 0;
  Object.defineProperty(AgentSession.prototype, "start", {
    configurable: true,
    value: () => Promise.resolve(),
  });
  Object.defineProperty(AgentSession.prototype, "sendPrompt", {
    configurable: true,
    value(this: AgentSession, text: string) {
      prompts += 1;
      this.recordUserMessage(text);
      queueMicrotask(() => {
        if (prompts === 1) {
          const error = {
            type: "error",
            message: "Provider temporarily unavailable",
          } as const;
          this.events.push(error);
          this.emit("event", error);
          return;
        }
        this.recordAssistantMessage(
          "# Working brand profile\n\nA recovered, evidence-backed brand profile with enough useful detail to be stored after the retry completes successfully for onboarding.",
        );
        const result = { type: "result", ok: true } as const;
        this.events.push(result);
        this.emit("event", result);
      });
      return Promise.resolve();
    },
  });
  try {
    await manager.createRootChat(
      "workspace",
      "retry-root",
      "Initial business review",
      "codex",
    );
    const result = await runSpecialistDelegation({
      manager,
      workspaceId: "workspace",
      conversationId: "retry-root",
      agentId: "brand",
      delegationId: "brand-profile",
      title: "Build the working brand profile",
      task: "Research the public brand and return the profile.",
      timeoutMs: 1_000,
      retryDelaysMs: [0],
    });

    assert.equal(prompts, 2);
    assert.equal(result.status, "completed");
    assert.equal(
      (await store.chatRecord("workspace", result.sessionId))?.status,
      "completed",
    );
  } finally {
    if (originalStart)
      Object.defineProperty(AgentSession.prototype, "start", originalStart);
    if (originalSend)
      Object.defineProperty(AgentSession.prototype, "sendPrompt", originalSend);
    await manager.stopAll();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("Setup retries through the provider-neutral specialist policy", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-setup-retry-"));
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
  let prompts = 0;
  Object.defineProperty(AgentSession.prototype, "start", {
    configurable: true,
    value: () => Promise.resolve(),
  });
  Object.defineProperty(AgentSession.prototype, "sendPrompt", {
    configurable: true,
    value(this: AgentSession, text: string) {
      prompts += 1;
      this.recordUserMessage(text);
      queueMicrotask(() => {
        if (prompts === 1) {
          const error = {
            type: "error",
            message: "Provider temporarily unavailable",
          } as const;
          this.events.push(error);
          this.emit("event", error);
          return;
        }
        this.recordAssistantMessage(
          "Setup recovered and returned the verified connection requirements.",
        );
        const result = { type: "result", ok: true } as const;
        this.events.push(result);
        this.emit("event", result);
      });
      return Promise.resolve();
    },
  });
  try {
    await manager.createRootChat(
      "workspace",
      "setup-retry-root",
      "Connection setup",
      "codex",
    );
    const result = await runSpecialistDelegation({
      manager,
      workspaceId: "workspace",
      conversationId: "setup-retry-root",
      agentId: "setup",
      delegationId: "setup-analytics",
      title: "Set up analytics",
      task: "Inspect the connection and return the next requirement.",
      timeoutMs: 1_000,
      retryDelaysMs: [0],
    });

    assert.equal(prompts, 2);
    assert.equal(result.status, "completed");
    assert.equal(
      (await store.chatRecord("workspace", result.sessionId))?.status,
      "completed",
    );
  } finally {
    if (originalStart)
      Object.defineProperty(AgentSession.prototype, "start", originalStart);
    if (originalSend)
      Object.defineProperty(AgentSession.prototype, "sendPrompt", originalSend);
    await manager.stopAll();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("an orphaned running onboarding specialist restarts immediately", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-specialist-orphan-"));
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
  let prompts = 0;
  Object.defineProperty(AgentSession.prototype, "start", {
    configurable: true,
    value: () => Promise.resolve(),
  });
  Object.defineProperty(AgentSession.prototype, "sendPrompt", {
    configurable: true,
    value(this: AgentSession, text: string) {
      prompts += 1;
      this.recordUserMessage(text);
      queueMicrotask(() => {
        this.recordAssistantMessage(
          "# Recovered profile\n\nThe orphaned specialist restarted cleanly and returned enough evidence-backed detail for the onboarding profile to complete successfully.",
        );
        const result = { type: "result", ok: true } as const;
        this.events.push(result);
        this.emit("event", result);
      });
      return Promise.resolve();
    },
  });
  try {
    await manager.createRootChat(
      "workspace",
      "orphan-root",
      "Initial business review",
      "codex",
    );
    await store.createChat({
      id: "orphaned-brand",
      organizationId: "workspace",
      parentId: "orphan-root",
      triggerId: "brand-profile",
      kind: "task",
      visibility: "private",
      agent: "brand",
      provider: "codex",
      title: "Build the working brand profile",
      status: "running",
    });

    const result = await runSpecialistDelegation({
      manager,
      workspaceId: "workspace",
      conversationId: "orphan-root",
      agentId: "brand",
      delegationId: "brand-profile",
      title: "Build the working brand profile",
      task: "Research the public brand and return the profile.",
      timeoutMs: 1_000,
      retryDelaysMs: [0],
    });

    assert.equal(result.sessionId, "orphaned-brand");
    assert.equal(result.status, "completed");
    assert.equal(prompts, 1);
  } finally {
    if (originalStart)
      Object.defineProperty(AgentSession.prototype, "start", originalStart);
    if (originalSend)
      Object.defineProperty(AgentSession.prototype, "sendPrompt", originalSend);
    await manager.stopAll();
    rmSync(directory, { recursive: true, force: true });
  }
});
