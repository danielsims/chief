import assert from "node:assert/strict";
import test from "node:test";

import type { AgentActivityComponent } from "@chief/relay-contracts";

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

void test("activity publisher surfaces relay write failures", async () => {
  const publisher = new RelayActivityPublisher(
    {
      upsertAgentActivity: () => Promise.reject(new Error("relay unavailable")),
    },
    "direct-advertising",
  );
  publisher.accept({ type: "thinkingStream", text: "Working." });

  await assert.rejects(
    publisher.flush(),
    /durable activity updates could not be published/i,
  );
});
