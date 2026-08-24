import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { JsonObject, JsonValue } from "@chief/relay-contracts";

import type { ChannelEvent } from "../src/channel-types.js";
import { handleChannelLocalTool } from "../src/channel-local-tools.js";
import { LocalStore } from "../src/local-store.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-channel-local-tools-integration-test-key";

function request(path: string, method: string, body?: JsonValue) {
  return new Request(`http://127.0.0.1:4318${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

void test("agent channel tools provide a reversible feature workflow", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-channel-tools-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const events: string[] = [];
  const pacedPosts: string[] = [];
  const context = {
    actor: { type: "agent" as const, id: "engineer", name: "Engineer" },
    channelStore: store.channelStore(),
    availableAgentIds: ["chief", "engineer", "analyst"],
    onChannelEvent: (event: { id: string }) => {
      events.push(event.id);
    },
    beforeMessagePost: (input: { idempotencyKey?: string }) => {
      if (input.idempotencyKey) pacedPosts.push(input.idempotencyKey);
    },
  };
  try {
    const locked = await handleChannelLocalTool(
      request("/local-tools/channels/general/archive", "POST", {}),
      "workspace-a",
      {},
      context,
    );
    assert.equal(locked.status, 403);
    assert.equal(
      (locked.value as { code: string }).code,
      "not_a_channel_member",
    );

    const createBody = {
      name: "Feature sharing",
      operationKey: "feature-sharing-work",
      kind: "feature",
      agentIds: ["analyst"],
      workstream: {
        status: "active",
        repository: "chief-example/chief",
        branch: "feature/sharing",
        pullRequestUrls: [],
      },
    };
    const created = await handleChannelLocalTool(
      request("/local-tools/channels", "POST", createBody),
      "workspace-a",
      createBody,
      context,
    );
    const channel = (
      created.value as { channel: { id: string; version: number } }
    ).channel;
    assert.equal(channel.version, 1);

    const retried = await handleChannelLocalTool(
      request("/local-tools/channels", "POST", createBody),
      "workspace-a",
      createBody,
      context,
    );
    assert.equal(
      (retried.value as { channel: { id: string } }).channel.id,
      channel.id,
    );

    const postBody = {
      content: "The feature branch is ready for review.",
      idempotencyKey: "feature-sharing-review-ready",
    };
    const posted = await handleChannelLocalTool(
      request(`/local-tools/channels/${channel.id}/messages`, "POST", postBody),
      "workspace-a",
      postBody,
      context,
    );
    const postedAgain = await handleChannelLocalTool(
      request(`/local-tools/channels/${channel.id}/messages`, "POST", postBody),
      "workspace-a",
      postBody,
      context,
    );
    assert.equal(
      (posted.value as { event: { id: string } }).event.id,
      (postedAgain.value as { event: { id: string } }).event.id,
    );
    assert.equal(events.length, 2);
    assert.deepEqual(pacedPosts, ["feature-sharing-review-ready"]);
    const archived = await handleChannelLocalTool(
      request(`/local-tools/channels/${channel.id}/archive`, "POST", {
        expectedVersion: 1,
      }),
      "workspace-a",
      { expectedVersion: 1 },
      context,
    );
    assert.equal(
      (archived.value as { channel: { lifecycle: string } }).channel.lifecycle,
      "archived",
    );
    const listed = await handleChannelLocalTool(
      request("/local-tools/channels", "GET"),
      "workspace-a",
      {},
      context,
    );
    assert.equal(
      (listed.value as { channels: { id: string }[] }).channels.some(
        (candidate) => candidate.id === channel.id,
      ),
      false,
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("agent invitations identify the caller and notify through a durable channel event", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-channel-invite-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const events: ChannelEvent[] = [];
  const context = {
    actor: { type: "agent" as const, id: "engineer", name: "Engineer" },
    channelStore: store.channelStore(),
    availableAgentIds: ["chief", "engineer", "analyst"],
    onChannelEvent: (event: ChannelEvent) => {
      events.push(event);
    },
  };
  const createBody = {
    name: "Agent CLI dogfood",
    operationKey: "agent-cli-dogfood-invite",
    members: [
      { type: "agent", id: "engineer" },
      { type: "user", id: "workspace-owner" },
    ],
  };
  try {
    const created = await handleChannelLocalTool(
      request("/local-tools/channels", "POST", createBody),
      "workspace-a",
      createBody,
      context,
    );
    const channel = (created.value as { channel: { id: string } }).channel;
    assert.equal(events.length, 1);
    const invitation = events[0];
    assert.ok(invitation);
    assert.deepEqual(invitation.actor, {
      type: "agent",
      id: "engineer",
      name: "Engineer",
    });
    assert.equal(invitation.content, "Engineer added you to the channel.");
    assert.ok(
      invitation.tags.some(
        (tag) => tag[0] === "action" && tag[1] === "member-added",
      ),
    );
    assert.ok(
      invitation.tags.some(
        (tag) => tag[0] === "user" && tag[1] === "workspace-owner",
      ),
    );

    await handleChannelLocalTool(
      request("/local-tools/channels", "POST", createBody),
      "workspace-a",
      createBody,
      context,
    );
    assert.equal(events.length, 1);
    assert.equal(
      (await store.channelStore().events("workspace-a", channel.id)).length,
      1,
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("channel message commands project threads, edits, reactions, and tombstones", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-channel-messages-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const context = {
    actor: { type: "agent" as const, id: "engineer", name: "Engineer" },
    channelStore: store.channelStore(),
    availableAgentIds: ["chief", "engineer", "analyst"],
  };
  const call = (path: string, method: string, body: JsonObject = {}) =>
    handleChannelLocalTool(
      request(path, method, method === "GET" ? undefined : body),
      "workspace-a",
      body,
      context,
    );
  try {
    const create = await call("/local-tools/channels", "POST", {
      name: "Engineering runtime",
      operationKey: "engineering-runtime-tests",
      kind: "feature",
      members: [{ type: "agent", id: "analyst" }],
    });
    const channel = (create.value as { channel: { id: string } }).channel;

    const root = await call(
      `/local-tools/channels/${channel.id}/messages`,
      "POST",
      {
        content: "The runtime foundation is ready.",
        mentions: ["analyst"],
        idempotencyKey: "runtime-root",
      },
    );
    const rootId = (root.value as { event: { id: string } }).event.id;
    const reply = await call(
      `/local-tools/channels/${channel.id}/messages`,
      "POST",
      {
        content: "I verified the storage layer.",
        threadRootId: rootId,
        idempotencyKey: "runtime-reply",
      },
    );
    const replyId = (reply.value as { event: { id: string } }).event.id;

    const timeline = await call(
      `/local-tools/channels/${channel.id}/messages?limit=10`,
      "GET",
    );
    assert.deepEqual(
      (timeline.value as { messages: { id: string }[] }).messages.map(
        (item) => item.id,
      ),
      [rootId],
    );
    const recentReplies = (
      timeline.value as {
        messages: {
          recentReplies: {
            id: string;
            content: string;
            threadRootId?: string;
          }[];
        }[];
      }
    ).messages[0]?.recentReplies;
    assert.ok(recentReplies);
    assert.equal(recentReplies.length, 1);
    const recentReply = recentReplies[0];
    assert.ok(recentReply);
    assert.equal(recentReply.id, replyId);
    assert.equal(recentReply.content, "I verified the storage layer.");
    assert.equal(recentReply.threadRootId, rootId);
    const thread = await call(
      `/local-tools/channels/${channel.id}/messages/${rootId}/replies`,
      "GET",
    );
    assert.deepEqual(
      (thread.value as { messages: { id: string }[] }).messages.map(
        (item) => item.id,
      ),
      [rootId, replyId],
    );

    const editConflict = await call(
      `/local-tools/channels/${channel.id}/messages/${rootId}`,
      "PATCH",
      {
        content: "Wrong version",
        expectedVersion: 2,
      },
    );
    assert.equal(editConflict.status, 409);
    const edited = await call(
      `/local-tools/channels/${channel.id}/messages/${rootId}`,
      "PATCH",
      {
        content: "The runtime foundation is tested and ready.",
        expectedVersion: 1,
      },
    );
    assert.equal(
      (edited.value as { message: { version: number; content: string } })
        .message.version,
      2,
    );

    const reacted = await call(
      `/local-tools/channels/${channel.id}/messages/${rootId}/reactions`,
      "POST",
      { emoji: "✅" },
    );
    const reactedAgain = await call(
      `/local-tools/channels/${channel.id}/messages/${rootId}/reactions`,
      "POST",
      { emoji: "✅" },
    );
    assert.equal(
      (reacted.value as { event: { id: string } }).event.id,
      (reactedAgain.value as { event: { id: string } }).event.id,
    );
    const reactions = await call(
      `/local-tools/channels/${channel.id}/messages/${rootId}/reactions`,
      "GET",
    );
    assert.equal(
      (reactions.value as { reactions: { count: number }[] }).reactions[0]
        ?.count,
      1,
    );
    const removed = await call(
      `/local-tools/channels/${channel.id}/messages/${rootId}/reactions/${encodeURIComponent("✅")}`,
      "DELETE",
    );
    assert.equal((removed.value as { removed: boolean }).removed, true);

    const search = await call(
      "/local-tools/messages/search?query=tested",
      "GET",
    );
    assert.equal((search.value as { messages: unknown[] }).messages.length, 1);
    const replySearch = await call(
      "/local-tools/messages/search?query=verified",
      "GET",
    );
    const replyMatch = (
      replySearch.value as {
        messages: { id: string; threadRoot?: { id: string } }[];
      }
    ).messages[0];
    assert.ok(replyMatch);
    assert.equal(replyMatch.id, replyId);
    assert.equal(replyMatch.threadRoot?.id, rootId);
    const deleted = await call(
      `/local-tools/channels/${channel.id}/messages/${rootId}`,
      "DELETE",
      { reason: "superseded" },
    );
    assert.equal(
      (deleted.value as { message: { deleted: boolean } }).message.deleted,
      true,
    );
    const activity = await call(
      `/local-tools/channels/${channel.id}/activity`,
      "GET",
    );
    const entries = (
      activity.value as {
        activity: {
          action: string;
          sequence: number;
          previousHash?: string;
          hash: string;
        }[];
      }
    ).activity;
    const actions = entries.map((entry) => entry.action);
    assert.ok(actions.includes("message.edited"));
    assert.ok(actions.includes("message.deleted"));
    assert.ok(actions.includes("reaction.added"));
    assert.ok(actions.includes("reaction.removed"));
    assert.deepEqual(
      entries.map((entry) => entry.sequence),
      entries.map((_entry, index) => index + 1),
    );
    for (let index = 1; index < entries.length; index += 1) {
      assert.equal(entries[index]?.previousHash, entries[index - 1]?.hash);
    }
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("channel membership, lifecycle, and policy commands remain conflict safe", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-channel-policy-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const context = {
    actor: { type: "agent" as const, id: "engineer", name: "Engineer" },
    channelStore: store.channelStore(),
    availableAgentIds: ["chief", "engineer", "analyst"],
    requestDeletion: () => Promise.resolve({ id: "owner-review" }),
  };
  const call = (path: string, method: string, body: JsonObject = {}) =>
    handleChannelLocalTool(
      request(path, method, method === "GET" ? undefined : body),
      "workspace-a",
      body,
      context,
    );
  try {
    const created = await call("/local-tools/channels", "POST", {
      name: "Engineering policy",
      operationKey: "engineering-policy-tests",
    });
    let channel = (
      created.value as { channel: { id: string; version: number } }
    ).channel;
    const members = await call(
      `/local-tools/channels/${channel.id}/members`,
      "GET",
    );
    assert.deepEqual(
      (members.value as { members: { id: string }[] }).members.map(
        (member) => member.id,
      ),
      ["engineer"],
    );
    const added = await call(
      `/local-tools/channels/${channel.id}/members`,
      "POST",
      {
        members: [
          { type: "user", id: "workspace-owner" },
          { type: "agent", id: "analyst" },
        ],
        expectedVersion: channel.version,
      },
    );
    channel = (added.value as { channel: typeof channel }).channel;
    const stale = await call(`/local-tools/channels/${channel.id}`, "PATCH", {
      topic: "stale",
      expectedVersion: 1,
    });
    assert.equal(stale.status, 409);
    const updated = await call(`/local-tools/channels/${channel.id}`, "PATCH", {
      topic: "Runtime ownership and reliability",
      expectedVersion: channel.version,
      workstream: { status: "review", pullRequestUrls: [] },
    });
    channel = (updated.value as { channel: typeof channel }).channel;
    const removedOwner = await call(
      `/local-tools/channels/${channel.id}/members/workspace-owner`,
      "DELETE",
      { expectedVersion: channel.version },
    );
    assert.equal(removedOwner.status, 409);
    const archive = await call(
      `/local-tools/channels/${channel.id}/archive`,
      "POST",
      {
        expectedVersion: channel.version,
      },
    );
    channel = (archive.value as { channel: typeof channel }).channel;
    const restore = await call(
      `/local-tools/channels/${channel.id}/unarchive`,
      "POST",
      {
        expectedVersion: channel.version,
      },
    );
    channel = (restore.value as { channel: typeof channel }).channel;
    const deletion = await call(
      `/local-tools/channels/${channel.id}/deletion-request`,
      "POST",
      {
        reason:
          "The feature was cancelled and its retained history is no longer required.",
      },
    );
    assert.equal(
      (deletion.value as { actionItem: { id: string } }).actionItem.id,
      "owner-review",
    );
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
