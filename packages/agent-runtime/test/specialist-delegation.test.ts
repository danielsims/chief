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

void test("delegation follows the calling agent pack instead of a hardcoded persona", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-agent-pack-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const manager = new SessionManager(store);
  try {
    await manager.createRootChat(
      "workspace",
      "analyst-dm",
      "Analyst",
      "codex",
      undefined,
      "analyst",
    );
    await assert.rejects(
      runSpecialistDelegation({
        manager,
        workspaceId: "workspace",
        conversationId: "analyst-dm",
        delegationId: "try-brand",
        agentId: "brand",
        title: "Research brand",
        task: "Research the brand.",
      }),
      /Analyst cannot delegate/,
    );
  } finally {
    await manager.stopAll();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("an initial review creates one Marketer despite rewritten concurrent calls", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-specialist-"));
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
  let starts = 0;
  let prompts = 0;
  Object.defineProperty(AgentSession.prototype, "start", {
    configurable: true,
    value() {
      starts += 1;
      return Promise.resolve();
    },
  });
  Object.defineProperty(AgentSession.prototype, "sendPrompt", {
    configurable: true,
    value(this: AgentSession, text: string) {
      prompts += 1;
      assert.equal(
        this.agent.instructions.match(/Reactions are real agent actions/gu)
          ?.length,
        1,
      );
      this.recordUserMessage(text);
      queueMicrotask(() => {
        this.recordAssistantMessage(
          "# Working brand profile\n\nEvidence-backed profile content that is intentionally longer than one hundred characters for durable storage.",
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
      "root",
      "Initial business review",
      "codex",
    );
    const base = {
      manager,
      workspaceId: "workspace",
      conversationId: "root",
      agentId: "brand",
      timeoutMs: 2_000,
    };
    const results = await Promise.all([
      runSpecialistDelegation({
        ...base,
        delegationId: "brand-review-one",
        title: "Research the brand",
        task: "Research the first-party site and return one complete Markdown brand profile.",
      }),
      runSpecialistDelegation({
        ...base,
        delegationId: "business-research",
        title: "Research program brand and build working profile",
        task: "Study the business, market, voice, and visual identity before building the profile.",
      }),
      runSpecialistDelegation({
        ...base,
        delegationId: "working-profile",
        title: "Build the working brand profile",
        task: "Use public sources to produce the evidence-backed working brand document.",
      }),
      runSpecialistDelegation({
        ...base,
        delegationId: "research-program",
        title: "Research Program brand and build working profile",
        task: "Research the brand program and assemble a practical working profile for Chief.",
      }),
    ]);

    assert.equal(new Set(results.map((result) => result.sessionId)).size, 1);
    assert.equal(starts, 1);
    assert.equal(prompts, 1);
    assert.equal((await store.listChildChats("workspace", "root")).length, 1);
    const prospectResults = await Promise.all([
      runSpecialistDelegation({
        ...base,
        agentId: "prospector",
        delegationId: "initial-prospects",
        title: "Find initial prospects",
        task: "Find qualified public buying signals and save each result.",
      }),
      runSpecialistDelegation({
        ...base,
        agentId: "prospector",
        delegationId: "buying-signals",
        title: "Populate the prospect table",
        task: "Research recent conversations and persist strong prospects with source URLs.",
      }),
    ]);
    assert.equal(
      new Set(prospectResults.map((result) => result.sessionId)).size,
      1,
    );
    assert.equal(starts, 2);
    assert.equal(prompts, 2);
    assert.equal((await store.listChildChats("workspace", "root")).length, 2);
  } finally {
    if (originalStart) {
      Object.defineProperty(AgentSession.prototype, "start", originalStart);
    }
    if (originalSend) {
      Object.defineProperty(AgentSession.prototype, "sendPrompt", originalSend);
    }
    await manager.stopAll();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("initial-review child projection collapses legacy Brand Researcher duplicates", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-specialist-legacy-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const manager = new SessionManager(store);
  try {
    await manager.createRootChat(
      "workspace",
      "random-root-id",
      "Initial business review",
      "codex",
    );
    for (const [index, status] of (
      ["failed", "running", "completed"] as const
    ).entries()) {
      await store.createChat({
        id: `legacy-brand-${index}`,
        organizationId: "workspace",
        parentId: "random-root-id",
        triggerId: `legacy-trigger-${index}`,
        kind: "task",
        visibility: "private",
        agent: "brand",
        provider: "codex",
        title: "Research Program brand and build working profile",
        status,
        updatedAt: index + 1,
      });
    }

    const children = await manager.childChats("workspace", "random-root-id");
    assert.equal(children.length, 1);
    assert.equal(children[0]?.id, "legacy-brand-2");
  } finally {
    await manager.stopAll();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("ordinary delegations use the caller ID rather than mutable wording", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-specialist-id-"));
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
        this.recordAssistantMessage("Evidence-backed specialist result.");
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
      "general-root",
      "General marketing",
      "codex",
    );
    const base = {
      manager,
      workspaceId: "workspace",
      conversationId: "general-root",
      agentId: "brand",
      timeoutMs: 2_000,
    };
    const first = await runSpecialistDelegation({
      ...base,
      delegationId: "stable-brand-review",
      title: "Review brand",
      task: "Review the website.",
    });
    const rewritten = await runSpecialistDelegation({
      ...base,
      delegationId: "stable-brand-review",
      title: "Review the public brand",
      task: "Review the website and launch material.",
    });
    const distinct = await runSpecialistDelegation({
      ...base,
      delegationId: "second-brand-review",
      title: "Review brand",
      task: "Review the website.",
    });

    assert.equal(first.sessionId, rewritten.sessionId);
    assert.notEqual(first.sessionId, distinct.sessionId);
    assert.equal(prompts, 2);
    assert.equal(
      (await store.listChildChats("workspace", "general-root")).length,
      2,
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

void test("specialist timeout follows progress and interrupts a stalled turn", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-specialist-timeout-"));
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
  const originalInterrupt = Object.getOwnPropertyDescriptor(
    AgentSession.prototype,
    "interrupt",
  );
  let interrupts = 0;
  Object.defineProperty(AgentSession.prototype, "start", {
    configurable: true,
    value: () => Promise.resolve(),
  });
  Object.defineProperty(AgentSession.prototype, "interrupt", {
    configurable: true,
    value: () => {
      interrupts += 1;
      return Promise.resolve();
    },
  });
  Object.defineProperty(AgentSession.prototype, "sendPrompt", {
    configurable: true,
    value(this: AgentSession, text: string) {
      this.recordUserMessage(text);
      if (text === "keep making progress") {
        for (const delay of [10, 20, 30, 40]) {
          setTimeout(
            () => this.emit("event", { type: "stream", text: "." }),
            delay,
          );
        }
        setTimeout(() => {
          this.recordAssistantMessage("Finished after steady progress.");
          const result = { type: "result", ok: true } as const;
          this.events.push(result);
          this.emit("event", result);
        }, 48);
      }
      return Promise.resolve();
    },
  });
  try {
    await manager.createRootChat(
      "workspace",
      "timeout-root",
      "General marketing",
      "codex",
    );
    const base = {
      manager,
      workspaceId: "workspace",
      conversationId: "timeout-root",
      agentId: "analyst",
      title: "Analyze performance",
      timeoutMs: 18,
      retryDelaysMs: [],
    };
    const progressing = await runSpecialistDelegation({
      ...base,
      delegationId: "progressing-analysis",
      task: "keep making progress",
    });
    const stalled = await runSpecialistDelegation({
      ...base,
      delegationId: "stalled-analysis",
      task: "never finish",
    });

    assert.equal(progressing.status, "completed");
    assert.equal(stalled.status, "failed");
    assert.match(stalled.error, /without progress/);
    assert.equal(interrupts, 1);
  } finally {
    if (originalStart)
      Object.defineProperty(AgentSession.prototype, "start", originalStart);
    if (originalSend)
      Object.defineProperty(AgentSession.prototype, "sendPrompt", originalSend);
    if (originalInterrupt) {
      Object.defineProperty(
        AgentSession.prototype,
        "interrupt",
        originalInterrupt,
      );
    }
    await manager.stopAll();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("restart reconciliation fails only orphaned local specialists", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-specialist-restart-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  try {
    await store.createChat({
      id: "root",
      organizationId: "workspace",
      kind: "conversation",
      visibility: "user",
      agent: "chief",
      provider: "codex",
      title: "Root",
    });
    for (const [id, provider] of [
      ["local-child", "codex"],
      ["remote-child", "remote"],
    ] as const) {
      await store.createChat({
        id,
        organizationId: "workspace",
        parentId: "root",
        kind: "task",
        visibility: "private",
        agent: "brand",
        provider,
        title: "Research",
        status: "running",
        updatedAt: 1,
      });
    }
    assert.equal(
      await store.reconcileInterruptedSpecialistSessions(Date.now()),
      1,
    );
    assert.equal(
      (await store.chatRecord("workspace", "local-child"))?.status,
      "failed",
    );
    assert.equal(
      (await store.chatRecord("workspace", "remote-child"))?.status,
      "running",
    );
    assert.equal(await store.reconcileStaleActivitySessions(Date.now()), 1);
    assert.equal(
      (await store.chatRecord("workspace", "remote-child"))?.status,
      "failed",
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("specialist startup failure commits terminal state without a user message", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-specialist-startup-"));
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
  Object.defineProperty(AgentSession.prototype, "start", {
    configurable: true,
    value: () => Promise.resolve(),
  });
  Object.defineProperty(AgentSession.prototype, "sendPrompt", {
    configurable: true,
    value: () => Promise.reject(new Error("Provider unavailable")),
  });
  const observedStatuses: string[] = [];
  try {
    await manager.createRootChat(
      "workspace",
      "startup-root",
      "General marketing",
      "codex",
    );
    const result = await runSpecialistDelegation({
      manager,
      workspaceId: "workspace",
      conversationId: "startup-root",
      agentId: "brand",
      delegationId: "startup-failure",
      title: "Research brand",
      task: "Research the website.",
      timeoutMs: 1_000,
      onStateChange: async () => {
        const child = (
          await store.listChildChats("workspace", "startup-root")
        )[0];
        if (child) observedStatuses.push(child.status);
      },
    });
    const stored = await store.chatRecord("workspace", result.sessionId);
    if (!stored) assert.fail("Expected the failed specialist session.");
    assert.equal(result.status, "failed");
    assert.equal(stored.status, "failed");
    assert.ok(stored.finishedAt);
    assert.equal(stored.error, "Provider unavailable");
    assert.equal(observedStatuses.at(-1), "failed");
  } finally {
    if (originalStart)
      Object.defineProperty(AgentSession.prototype, "start", originalStart);
    if (originalSend)
      Object.defineProperty(AgentSession.prototype, "sendPrompt", originalSend);
    await manager.stopAll();
    rmSync(directory, { recursive: true, force: true });
  }
});
