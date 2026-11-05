import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { ConversationMessage, JsonObject } from "@chief/relay-contracts";
import {
  CHANNEL_PAGE_MAX_CHARS,
  channelMessagePaging,
  compactChannelMessagePage,
} from "@chief/agent-runtime/channel-message-page";
import {
  agentJobSchema,
  agentPrincipalSchema,
  appendMessageCommandSchema,
  conversationMessageSchema,
} from "@chief/relay-contracts";

import type { ConversationObject } from "../src/conversation-object";
import { listChannelMessagesDefinition } from "../../../packages/agent-runtime/src/tools/toolkits/channels/messages/list-channel-messages";
import { SqlConversationStore } from "../src/conversation-store";
import { listMessages } from "../src/hosted-agent-tools/toolkits/channels";
import { hexKey, relayTestEnv } from "./helpers";

function message(
  sequence: number,
  body = `Prospect ${sequence}`,
): ConversationMessage {
  return conversationMessageSchema.parse({
    id: `message-${sequence}`,
    workspaceId: "workspace-history",
    conversationId: "history",
    author: { kind: "agent", id: "prospector" },
    body,
    components: [],
    createdAt: "2026-10-28T00:00:00.000Z",
    sequence,
  });
}

describe("bounded channel history contract", () => {
  it("defaults the tool schema and both runtime handlers to five recent messages", () => {
    expect(listChannelMessagesDefinition.querySchema.parse({})).toMatchObject({
      limit: 5,
    });
    expect(channelMessagePaging({})).toEqual({ limit: 5, recent: true });
    expect(channelMessagePaging({ limit: 25, cursor: "42" })).toEqual({
      limit: 25,
      recent: true,
      before: 42,
    });
    const invalidInputs: JsonObject[] = [
      { limit: 0 },
      { limit: 101 },
      { limit: 1.5 },
      { limit: "NaN" },
      { cursor: "message-42" },
      { cursor: "0" },
      { cursor: "1e2" },
      { cursor: true },
    ];
    for (const input of invalidInputs)
      expect(() => channelMessagePaging(input)).toThrow();
  });

  it("returns the newest text and discards rich run-log payloads", () => {
    const activity = message(99, "");
    activity.components = [
      {
        id: "thinking-99",
        kind: "thinking",
        version: 1,
        payload: { text: "secret".repeat(16000) },
      },
    ];
    const page = compactChannelMessagePage({
      messages: [
        message(1),
        message(2),
        message(3),
        message(4),
        message(5),
        message(6),
        activity,
      ],
      nextSequence: 1,
    });
    expect(page.messages.map((m) => m.sequence)).toEqual([6, 5, 4, 3, 2]);
    expect(page.nextSequence).toBe(2);
    expect(JSON.stringify(page)).not.toContain("secret");
    expect(Object.keys(page)[0]).toBe("nextSequence");
  });

  it("marks previews explicitly and bounds the serialized page including escaping", () => {
    const body = '\\"\n'.repeat(5000);
    const page = compactChannelMessagePage(
      {
        messages: Array.from({ length: 20 }, (_, i) => message(i + 1, body)),
        nextSequence: 1,
      },
      100,
    );
    expect(JSON.stringify(page).length).toBeLessThanOrEqual(
      CHANNEL_PAGE_MAX_CHARS,
    );
    expect(page.budgetLimited).toBe(true);
    expect(page.messages[0]?.bodyTruncated).toBe(true);
    expect(page.messages[0]?.bodyLength).toBe(body.length);
    expect(page.nextSequence).toBe(page.messages.at(-1)?.sequence);
  });

  it("pages through a long history without skipping messages at the payload boundary", () => {
    const history = Array.from({ length: 23 }, (_, i) =>
      message(i + 1, '"'.repeat(5000)),
    );
    let cursor: number | undefined;
    const ids: number[] = [];
    for (let pageNumber = 0; pageNumber < 30; pageNumber++) {
      const remaining = history.filter(
        (m) => cursor === undefined || m.sequence < cursor,
      );
      const raw = remaining.slice(-10);
      const page = compactChannelMessagePage(
        {
          messages: raw,
          nextSequence:
            remaining.length > raw.length ? (raw[0]?.sequence ?? null) : null,
        },
        10,
      );
      ids.push(...page.messages.map((m) => m.sequence));
      if (page.nextSequence === null) break;
      expect(page.nextSequence).toBeLessThan(cursor ?? Infinity);
      cursor = page.nextSequence;
    }
    expect(ids).toEqual(Array.from({ length: 23 }, (_, i) => 23 - i));
    expect(new Set(ids).size).toBe(23);
  });

  it("keeps artifact identifiers but not arbitrary component payloads", () => {
    const artifact = message(1, "");
    artifact.components = [
      {
        id: "artifact-a",
        kind: "artifact",
        version: 1,
        payload: { nested: "large".repeat(10000) },
      },
    ];
    const page = compactChannelMessagePage({
      messages: [artifact],
      nextSequence: null,
    });
    expect(page.messages[0]?.components).toEqual([
      { id: "artifact-a", kind: "artifact" },
    ]);
    expect(page.nextSequence).toBeNull();
  });
});

describe("hosted handler with the real conversation store", () => {
  it("reads five newest messages, honors the cursor and preserves the original stored content", async () => {
    const env = relayTestEnv();
    const workspaceId = "workspace-history";
    const channelId = `history-${crypto.randomUUID()}`;
    const principal = agentPrincipalSchema.parse({
      kind: "agent",
      agentId: "prospector",
      pubkey: hexKey("history-prospector"),
      workspaceId,
      role: "member",
    });
    const stub = env.CONVERSATIONS.get(
      env.CONVERSATIONS.idFromName(`${workspaceId}:${channelId}`),
    );
    await runInDurableObject(
      stub,
      async (_instance: ConversationObject, state) => {
        const store = new SqlConversationStore(state.storage);
        store.initialize();
        for (let i = 1; i <= 12; i++)
          store.append({
            workspaceId: principal.workspaceId,
            actor: principal,
            author: { kind: "agent", id: principal.agentId },
            command: appendMessageCommandSchema.parse({
              commandId: crypto.randomUUID(),
              protocolVersion: 1,
              occurredAt: "2026-10-28T00:00:00.000Z",
              payload: {
                messageId: `message-${i}`,
                conversationId: channelId,
                body: `Shortlist ${i}`,
                mentions: [],
                components: [],
              },
            }),
          });
      },
    );
    const now = "2026-10-28T00:00:00.000Z";
    const job = agentJobSchema.parse({
      id: crypto.randomUUID(),
      workspaceId,
      agentId: "prospector",
      kind: "conversation.message",
      payload: {},
      status: "leased",
      attempt: 1,
      availableAt: now,
      leaseExpiresAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const first = await listMessages(env, job, principal, { channelId });
    expect(first.messages.map((m) => m.sequence)).toEqual([12, 11, 10, 9, 8]);
    expect(first.nextSequence).toBe(8);
    const second = await listMessages(env, job, principal, {
      channelId,
      cursor: String(first.nextSequence),
    });
    expect(second.messages.map((m) => m.sequence)).toEqual([7, 6, 5, 4, 3]);
    const third = await listMessages(env, job, principal, {
      channelId,
      cursor: String(second.nextSequence),
    });
    expect(third.messages.map((m) => m.sequence)).toEqual([2, 1]);
    expect(third.nextSequence).toBeNull();
    await runInDurableObject(
      stub,
      async (_instance: ConversationObject, state) => {
        const store = new SqlConversationStore(state.storage);
        store.initialize();
        expect(store.getMessage("message-12")?.body).toBe("Shortlist 12");
      },
    );
  });
});

it("expands one shortlist so a third prospect is not hidden by the default preview", () => {
  const body =
    "First prospect and evidence. ".repeat(90) +
    "Third prospect: Verified Person, Founder at Example.";
  const source = { messages: [message(42, body)], nextSequence: null };
  expect(compactChannelMessagePage(source).messages[0]?.bodyTruncated).toBe(
    true,
  );
  const paging = channelMessagePaging({
    cursor: 43,
    limit: 1,
    bodyChars: 8000,
  });
  expect(paging.before).toBe(43);
  const expanded = compactChannelMessagePage(
    source,
    paging.limit,
    paging.bodyChars,
  );
  expect(expanded.messages[0]?.body).toContain(
    "Third prospect: Verified Person",
  );
  expect(expanded.messages[0]?.bodyTruncated).toBe(false);
  expect(JSON.stringify(expanded).length).toBeLessThanOrEqual(
    CHANNEL_PAGE_MAX_CHARS,
  );
  expect(() => channelMessagePaging({ bodyChars: 8001 })).toThrow();
});

it("keeps a message and a usable cursor when an expanded escaped body exceeds the page budget", () => {
  const page = compactChannelMessagePage(
    {
      messages: [message(42, '\\"\n'.repeat(8000)), message(41)],
      nextSequence: 40,
    },
    1,
    8000,
  );
  expect(page.messages[0]?.sequence).toBe(42);
  expect(page.messages[0]?.bodyTruncated).toBe(true);
  expect(page.nextSequence).toBe(42);
  expect(JSON.stringify(page).length).toBeLessThanOrEqual(
    CHANNEL_PAGE_MAX_CHARS,
  );
});
