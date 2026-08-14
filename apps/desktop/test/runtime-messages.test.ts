import assert from "node:assert/strict";
import test from "node:test";

import type { ChiefUIMessage } from "@chief/agent-runtime/types";

import {
  channelActivityOnlyMessage,
  deduplicateDocumentParts,
  dropReplayedMessages,
  dropReplayedToolMessages,
  mergeRuntimeHistory,
  mergeRuntimeMessage,
  projectChannelTimeline,
  projectConversationMessages,
  visibleRuntimeError,
} from "../src/lib/runtime-messages.js";

const documentMessage = (
  id: string,
  threadRootId?: string,
): ChiefUIMessage => ({
  id,
  role: "assistant",
  ...(threadRootId ? { metadata: { createdAt: 1, threadRootId } } : {}),
  parts: [
    {
      type: "data-document",
      id: "document-file-1",
      data: {
        fileId: "file-1",
        title: "Working brand profile.md",
        path: "brand/working-brand-profile.md",
        kind: "document",
        versionId: "version-1",
      },
    },
  ],
});

void test("a thread-owned file wins over a later threadless replay", () => {
  const messages = deduplicateDocumentParts([
    documentMessage("thread-file", "brand-thread"),
    documentMessage("replayed-file"),
  ]);

  assert.equal(messages[0]?.parts.length, 1);
  assert.equal(messages[1]?.parts.length, 0);
});

void test("shared channels keep activity while hiding unpublished narration", () => {
  const hidden = channelActivityOnlyMessage({
    id: "narration",
    role: "assistant",
    parts: [{ type: "text", text: "Let me inspect the workspace." }],
  });
  assert.equal(hidden, undefined);

  const activity = channelActivityOnlyMessage({
    id: "working",
    role: "assistant",
    parts: [
      { type: "text", text: "Let me open the browser." },
      {
        type: "tool-browser",
        toolCallId: "browser-call",
        state: "input-available",
        input: {},
      },
    ],
  });
  assert.deepEqual(activity?.parts, [
    {
      type: "tool-browser",
      toolCallId: "browser-call",
      state: "input-available",
      input: {},
    },
  ]);
});

void test("published channel events own visible text and keep runtime activity", () => {
  const projected = projectChannelTimeline(
    [
      {
        id: "narration",
        role: "assistant",
        parts: [{ type: "text", text: "Let me inspect the workspace." }],
      },
      {
        id: "browser-activity",
        role: "assistant",
        metadata: { createdAt: 2 },
        parts: [
          {
            type: "tool-browser",
            toolCallId: "browser-call",
            state: "input-available",
            input: {},
          },
        ],
      },
    ],
    [
      {
        protocol: "nip29",
        kind: 9,
        id: "published-event",
        channelId: "mission-control",
        pubkey: "chief",
        actor: { type: "agent", id: "chief", name: "Chief" },
        content: "I found something useful.",
        parts: [],
        tags: [],
        createdAt: 1,
      },
    ],
  );

  assert.deepEqual(
    projected.map((message) => message.id),
    ["published-event", "browser-activity"],
  );
  assert.equal(
    projected[0]?.parts.some(
      (part) =>
        part.type === "text" && part.text === "I found something useful.",
    ),
    true,
  );
});

void test("direct messages keep authored replies even when routed through a channel id", () => {
  const messages: ChiefUIMessage[] = [
    {
      id: "user-request",
      role: "user",
      parts: [{ type: "text", text: "Set an action item for me." }],
    },
    {
      id: "chief-reply",
      role: "assistant",
      parts: [{ type: "text", text: "Done. I raised the action item." }],
    },
  ];

  assert.deepEqual(
    projectConversationMessages(messages, [], "direct").map(
      (message) => message.id,
    ),
    ["user-request", "chief-reply"],
  );
  assert.deepEqual(
    projectConversationMessages(messages, [], "channel").map(
      (message) => message.id,
    ),
    ["user-request"],
  );
});

void test("durable plugin recommendations render in channels and direct messages", () => {
  const plugin = {
    id: "github",
    name: "GitHub",
    description: "Connect issues and pull requests.",
    category: "Engineering",
    homepage: "https://github.com",
    source: {
      type: "discovery" as const,
      registry: "integrations.sh",
      domain: "github.com",
    },
    status: "available" as const,
    enabled: false,
    trusted: false,
  };
  const events = [
    {
      protocol: "nip29" as const,
      kind: 9 as const,
      id: "plugin-event",
      channelId: "engineering",
      pubkey: "engineer",
      actor: { type: "agent" as const, id: "engineer", name: "Engineer" },
      content: "I’d start with GitHub.",
      parts: [
        {
          type: "data-plugin-recommendations",
          data: { plugins: [plugin] },
        },
      ],
      tags: [["client", "channel-api:engineering-plugins"]],
      createdAt: 2,
    },
  ];

  for (const surface of ["channel", "direct"] as const) {
    const projected = projectConversationMessages([], events, surface);
    assert.equal(projected[0]?.id, "channel-api:engineering-plugins");
    assert.deepEqual(projected[0].parts, [
      { type: "text", text: "I’d start with GitHub." },
      {
        type: "data-plugin-recommendations",
        data: { plugins: [plugin] },
      },
    ]);
  }
});

void test("published replies retain the agent that authored them", () => {
  const [reply] = projectChannelTimeline(
    [],
    [
      {
        protocol: "nip29",
        kind: 9,
        id: "marketer-ack",
        channelId: "mission-control",
        pubkey: "marketer",
        actor: { type: "agent", id: "brand", name: "Marketer" },
        content: "I’m on it. I’ve started this in #marketing.",
        parts: [],
        tags: [["e", "brand-assignment", "", "root"]],
        createdAt: 1,
      },
    ],
  );

  assert.equal(reply?.metadata?.agentId, "brand");
  assert.equal(reply.metadata.threadRootId, "brand-assignment");
});

void test("a delayed scheduled publication uses its channel arrival time", () => {
  const [published] = projectChannelTimeline(
    [
      {
        id: "heartbeat-reply",
        role: "assistant",
        metadata: { createdAt: 9 * 60 * 60 * 1_000 },
        parts: [{ type: "text", text: "Private scheduled output." }],
      },
    ],
    [
      {
        protocol: "nip29",
        kind: 9,
        id: "heartbeat-event",
        channelId: "mission-control",
        pubkey: "chief",
        actor: { type: "agent", id: "chief", name: "Chief" },
        content: "I moved the active work forward.",
        parts: [],
        tags: [["client", "heartbeat-reply"]],
        createdAt: 11.5 * 60 * 60 * 1_000,
      },
    ],
  );

  assert.equal(published?.metadata?.createdAt, 11.5 * 60 * 60 * 1_000);
});

void test("hides intentional cancellation and internal runtime failures", () => {
  assert.equal(visibleRuntimeError(" Turn interrupted "), undefined);
  assert.equal(visibleRuntimeError("Turn cancelled"), undefined);
  assert.equal(
    visibleRuntimeError("OpenCode exited unexpectedly with code 1."),
    undefined,
  );
  assert.equal(visibleRuntimeError("OpenCode stopped."), undefined);
  assert.equal(visibleRuntimeError("OpenCode service failure"), undefined);
  assert.equal(
    visibleRuntimeError("Agent process exited with code 1."),
    undefined,
  );
  assert.equal(
    visibleRuntimeError("Browser session failed"),
    "Browser session failed",
  );
});

const streamed = (text: string): ChiefUIMessage => ({
  id: "stream:chat",
  role: "assistant",
  parts: [{ type: "text", text, state: "streaming" }],
});

void test("preserves a complete stream when persistence is truncated", () => {
  const messages = mergeRuntimeMessage([streamed("Complete response")], {
    id: "durable",
    role: "assistant",
    parts: [{ type: "text", text: "Complete" }],
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.id, "durable");
  assert.deepEqual(messages[0].parts, [
    { type: "text", text: "Complete response" },
  ]);
});

void test("keeps streamed commentary before a tool-only message", () => {
  const messages = mergeRuntimeMessage([streamed("Checking Google now.")], {
    id: "tool",
    role: "assistant",
    parts: [
      {
        type: "tool-browser",
        toolCallId: "call",
        state: "input-available",
        input: {},
      },
    ],
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.id, "stream:chat:before:tool");
  assert.equal(messages[1]?.id, "tool");
});

void test("a reconnect snapshot keeps a newer optimistic channel message", () => {
  const optimistic: ChiefUIMessage = {
    id: "new-message",
    role: "user",
    parts: [{ type: "text", text: "@Chief open apple.com" }],
  };
  const older: ChiefUIMessage = {
    id: "older-message",
    role: "assistant",
    parts: [{ type: "text", text: "Earlier reply" }],
  };

  const messages = mergeRuntimeHistory([older, optimistic], [older]);

  assert.deepEqual(
    messages.map((message) => message.id),
    ["older-message", "new-message"],
  );
});

const toolMessage = (
  id: string,
  toolCallId: string,
  threadRootId?: string,
): ChiefUIMessage => ({
  id,
  role: "assistant",
  ...(threadRootId
    ? { metadata: { createdAt: 1, threadRootId } }
    : { metadata: { createdAt: 1 } }),
  parts: [
    {
      type: "dynamic-tool",
      toolCallId,
      toolName: "executor_execute",
      input: { code: "tools.search()" },
      state: "output-available",
      output: "ok",
    },
  ],
});

void test("drops replayed threadless copies that reuse tool call ids", () => {
  const messages = [
    toolMessage("original", "call_x", "root-1"),
    toolMessage("replayed", "call_x"),
  ];

  assert.deepEqual(
    dropReplayedToolMessages(messages).map((m) => m.id),
    ["original"],
  );
});

void test("keeps genuine threadless tool messages with fresh call ids", () => {
  const messages = [
    toolMessage("thread", "call_x", "root-1"),
    toolMessage("main", "call_y"),
  ];

  assert.deepEqual(
    dropReplayedToolMessages(messages).map((m) => m.id),
    ["thread", "main"],
  );
});

void test("thread-attached copies are never treated as replays", () => {
  const messages = [
    toolMessage("first", "call_x", "root-1"),
    toolMessage("second", "call_x", "root-1"),
  ];

  assert.deepEqual(
    dropReplayedToolMessages(messages).map((m) => m.id),
    ["first", "second"],
  );
});

void test("drops identical threadless text copies as replays", () => {
  const messages: ChiefUIMessage[] = [
    { id: "a", role: "assistant", parts: [{ type: "text", text: "Hello" }] },
    { id: "b", role: "assistant", parts: [{ type: "text", text: "Hello" }] },
  ];

  assert.deepEqual(
    dropReplayedToolMessages(messages).map((m) => m.id),
    ["a"],
  );
});

void test("drops replayed threadless text copies but keeps live messages", () => {
  const live: ChiefUIMessage = {
    id: "optimistic",
    role: "user",
    parts: [{ type: "text", text: "@Chief set up GitHub" }],
  };
  const replayed: ChiefUIMessage = {
    id: "replayed",
    role: "assistant",
    parts: [{ type: "text", text: "Checking GitHub." }],
  };
  const original: ChiefUIMessage = {
    id: "original",
    role: "assistant",
    metadata: { createdAt: 1, threadRootId: "root-1" },
    parts: [{ type: "text", text: "Checking GitHub." }],
  };

  const result = dropReplayedMessages([original, replayed, live]);

  assert.deepEqual(
    result.map((m) => m.id),
    ["original", "optimistic"],
  );
});
