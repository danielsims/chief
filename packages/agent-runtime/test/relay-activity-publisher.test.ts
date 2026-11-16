import assert from "node:assert/strict";
import test from "node:test";

import type { AgentActivityComponent } from "@chief/relay-contracts";
import { RelayClientError } from "@chief/relay-client";
import { agentActivityComponentSchema } from "@chief/relay-contracts";

import { RelayActivityPublisher } from "../src/relay-activity-publisher.js";

interface PublishedActivity {
  conversationId: string;
  messageId: string;
  threadRootId?: string;
  component: AgentActivityComponent;
}

void test("activity publisher preserves semantic order and stable tool identity", async () => {
  const published: PublishedActivity[] = [];
  const client = {
    upsertAgentActivity: (
      conversationId: string,
      input: Omit<PublishedActivity, "conversationId">,
    ) => {
      published.push({ conversationId, ...input });
      return Promise.resolve();
    },
  };
  const publisher = new RelayActivityPublisher(
    client,
    "direct-advertising",
    "root-1",
    {
      jobId: "job-1",
      runId: "run-1",
      providerSessionId: () => "provider-1",
    },
  );

  publisher.accept({ type: "thinkingStream", text: "Checking the workspace." });
  publisher.accept({
    type: "message",
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "tool-1",
        name: "relay_channels_list",
        input: {},
      },
    ],
  });
  publisher.accept({
    type: "message",
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "tool-1",
        content: '{"channels":[]}',
        is_error: false,
      },
    ],
  });
  publisher.accept({ type: "thinkingStream", text: "Preparing the summary." });
  publisher.accept({
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "The workspace has no channels yet." }],
  });
  await publisher.flush();

  assert.deepEqual(
    published.map(({ component }) => ({
      kind: component.kind,
      status: component.kind === "error" ? "failed" : component.payload.status,
    })),
    [
      { kind: "thinking", status: "completed" },
      { kind: "tool", status: "running" },
      { kind: "tool", status: "completed" },
      { kind: "thinking", status: "completed" },
    ],
  );
  const runningTool = published[1];
  const completedTool = published[2];
  assert.ok(runningTool);
  assert.ok(completedTool);
  assert.equal(runningTool.messageId, completedTool.messageId);
  assert.equal(runningTool.component.id, "tool-1");
  assert.equal(runningTool.conversationId, "direct-advertising");
  assert.equal(runningTool.threadRootId, "root-1");
  assert.deepEqual(completedTool.component.payload, {
    name: "relay_channels_list",
    status: "completed",
    input: "{}",
    output: '{"channels":[]}',
    runId: "run-1",
    jobId: "job-1",
    providerSessionId: "provider-1",
  });
  const finalActivity = published[3];
  assert.ok(finalActivity);
  const finalThinking = finalActivity.component;
  assert.equal(finalThinking.kind, "thinking");
  assert.equal(finalThinking.payload.text, "Preparing the summary.");
});

void test("activity delivery failures are logged without failing completed agent work", async (t) => {
  const warnings = t.mock.method(console, "warn", () => undefined);
  t.mock.method(console, "error", () => undefined);
  const publisher = new RelayActivityPublisher(
    {
      upsertAgentActivity: () => Promise.reject(new Error("relay unavailable")),
    },
    "direct-advertising",
  );
  publisher.accept({ type: "thinkingStream", text: "Working." });

  await assert.doesNotReject(publisher.flush());
  assert.equal(warnings.mock.callCount(), 1);
  assert.match(
    String(warnings.mock.calls[0]?.arguments[1]),
    /"failedUpdates":1/,
  );
  await publisher.flush();
  assert.equal(warnings.mock.callCount(), 1);
});

void test("long ACP command titles and oversized payloads satisfy relay validation", async () => {
  const published: AgentActivityComponent[] = [];
  const publisher = new RelayActivityPublisher(
    {
      upsertAgentActivity: (_conversationId, input) => {
        published.push(agentActivityComponentSchema.parse(input.component));
        return Promise.resolve();
      },
    },
    "direct-researcher",
  );
  const command = `node script.js ${"argument ".repeat(70)}`;
  const input = { command, body: "x".repeat(100_001) };
  publisher.accept({ type: "thinkingStream", text: "x".repeat(100_001) });
  publisher.accept({
    type: "message",
    role: "assistant",
    content: [
      { type: "tool_use", id: "long-command", name: command, input },
      { type: "tool_use", id: "blank-title", name: " ", input: {} },
    ],
  });
  for (const is_error of [false, true]) {
    publisher.accept({
      type: "message",
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "long-command",
          content: "x".repeat(100_001),
          is_error,
        },
      ],
    });
  }
  publisher.recordFailure("x".repeat(4_001));
  await publisher.flush();
  assert.equal(published.length, 6);
  const running = published[1];
  const blank = published[2];
  const completed = published[3];
  assert.ok(running?.kind === "tool");
  assert.ok(blank?.kind === "tool");
  assert.ok(completed?.kind === "tool");
  assert.match(running.payload.name, /truncated/);
  assert.equal(blank.payload.name, "Tool");
  assert.equal(running.payload.input, completed.payload.input);
  // Publication truncates its copy, preserving the actual tool arguments.
  assert.equal(input.body.length, 100_001);
  assert.equal(input.command, command);
});

void test("transient activity failures retry the same identity before later updates", async () => {
  const attempts: PublishedActivity[] = [];
  const publisher = new RelayActivityPublisher(
    {
      upsertAgentActivity: (conversationId, input, signal) => {
        assert.ok(signal);
        attempts.push({
          conversationId,
          ...input,
          component: agentActivityComponentSchema.parse(input.component),
        });
        if (attempts.length === 1)
          return Promise.reject(new RelayClientError("Busy", 503));
        if (attempts.length === 2)
          return Promise.reject(new TypeError("fetch failed"));
        agentActivityComponentSchema.parse(input.component);
        return Promise.resolve();
      },
    },
    "direct-researcher",
  );
  publisher.accept({
    type: "message",
    role: "assistant",
    content: [{ type: "tool_use", id: "tool-1", name: "bash", input: {} }],
  });
  publisher.accept({
    type: "message",
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "tool-1", content: "done" }],
  });
  await publisher.flush();
  assert.equal(attempts.length, 4);
  const first = attempts[0];
  assert.ok(first);
  assert.ok(attempts.every((attempt) => attempt.messageId === first.messageId));
  assert.deepEqual(
    attempts.map((attempt) =>
      attempt.component.kind === "tool"
        ? attempt.component.payload.status
        : undefined,
    ),
    ["running", "running", "running", "completed"],
  );
});

void test("permanent rejections are not retried and later activity still publishes", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  const errors = t.mock.method(console, "error", () => undefined);
  let attempts = 0;
  const publisher = new RelayActivityPublisher(
    {
      upsertAgentActivity: () => {
        attempts++;
        if (attempts === 1)
          return Promise.reject(
            new RelayClientError("Invalid activity", 400, "invalid_request"),
          );
        return Promise.resolve();
      },
    },
    "direct-researcher",
  );
  for (const id of ["first", "second"])
    publisher.accept({
      type: "message",
      role: "assistant",
      content: [{ type: "tool_use", id, name: "bash", input: {} }],
    });
  await publisher.flush();
  assert.equal(attempts, 2);
  const diagnostic = String(errors.mock.calls[0]?.arguments[1]);
  assert.match(diagnostic, /"httpStatus":400/);
  assert.match(diagnostic, /"errorCode":"invalid_request"/);
});

void test("transient failures exhaust a bounded retry budget without restarting work", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  t.mock.method(console, "error", () => undefined);
  let attempts = 0;
  const publisher = new RelayActivityPublisher(
    {
      upsertAgentActivity: () => {
        attempts++;
        return Promise.reject(new RelayClientError("Busy", 429));
      },
    },
    "direct-researcher",
  );
  publisher.accept({ type: "thinkingStream", text: "Working" });
  await publisher.flush();
  assert.equal(attempts, 3);
});

void test("activity publisher collapses queued thinking snapshots", async () => {
  const published: AgentActivityComponent[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstWrite = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const publisher = new RelayActivityPublisher(
    {
      upsertAgentActivity: async (_conversationId, input) => {
        published.push(agentActivityComponentSchema.parse(input.component));
        if (published.length === 1) await firstWrite;
      },
    },
    "direct-researcher",
  );

  publisher.accept({ type: "thinkingStream", text: "First. " });
  await new Promise((resolve) => setTimeout(resolve, 550));
  publisher.accept({ type: "thinkingStream", text: "Second. " });
  await new Promise((resolve) => setTimeout(resolve, 550));
  publisher.accept({ type: "thinkingStream", text: "Third." });
  releaseFirst?.();
  await publisher.flush();

  assert.equal(published.length, 2);
  const final = published.at(-1);
  assert.equal(final?.kind, "thinking");
  assert.equal(final.payload.status, "completed");
  assert.equal(final.payload.text, "First. Second. Third.");
});
