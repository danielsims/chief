import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { handleChannelLocalTool } from "../src/channel-local-tools.js";
import { LocalStore } from "../src/local-store.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-channel-agent-pressure-test-key";

const ITERATIONS = Number(process.env.CHIEF_PRESSURE_ITERATIONS ?? 40);

function request(path: string, method: string, body?: unknown) {
  return new Request(`http://127.0.0.1:4318${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

void test("agent message and reaction tools survive repeated threaded turns and restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-channel-pressure-"));
  const databasePath = join(directory, "chief.sqlite");
  let store = new LocalStore(databasePath);
  const workspaces = ["workspace-a", "workspace-b"] as const;
  const channels = new Map<string, string>();

  const call = (
    workspaceId: string,
    actor: { type: "user" | "agent"; id: string; name: string },
    path: string,
    method: string,
    body: Record<string, unknown> = {},
  ) =>
    handleChannelLocalTool(
      request(path, method, method === "GET" ? undefined : body),
      workspaceId,
      body,
      {
        actor,
        channelStore: store.channelStore(),
        availableAgentIds: ["chief", "engineer"],
      },
    );

  try {
    for (const workspaceId of workspaces) {
      const channel = await store.channelStore().create(workspaceId, {
        name: "Engineering pressure",
        operationKey: "engineering-pressure",
        agentIds: ["chief", "engineer"],
        userIds: ["workspace-owner"],
      });
      channels.set(workspaceId, channel.id);
    }

    for (let index = 0; index < ITERATIONS; index += 1) {
      const workspaceId =
        workspaces[index % workspaces.length] ?? "workspace-a";
      const channelId = channels.get(workspaceId);
      assert.ok(channelId);
      const user = {
        type: "user" as const,
        id: "workspace-owner",
        name: "Daniel Sims",
      };
      const engineer = {
        type: "agent" as const,
        id: "engineer",
        name: "Engineer",
      };
      const root = await call(
        workspaceId,
        user,
        `/local-tools/channels/${channelId}/messages`,
        "POST",
        {
          content: `Pressure request ${index}`,
          mentions: ["engineer"],
          idempotencyKey: `pressure-${index}-request`,
        },
      );
      const rootId = (root.value as { event: { id: string } }).event.id;

      const reaction = await call(
        workspaceId,
        engineer,
        `/local-tools/channels/${channelId}/messages/${rootId}/reactions`,
        "POST",
        { emoji: "👀" },
      );
      assert.equal(reaction.status, undefined);

      await call(
        workspaceId,
        engineer,
        `/local-tools/channels/${channelId}/messages`,
        "POST",
        {
          content: `I’m checking pressure request ${index} now.`,
          threadRootId: rootId,
          idempotencyKey: `pressure-${index}-ack`,
        },
      );
      await call(
        workspaceId,
        engineer,
        `/local-tools/channels/${channelId}/messages`,
        "POST",
        {
          content: `Pressure request ${index} is verified.`,
          threadRootId: rootId,
          idempotencyKey: `pressure-${index}-result`,
        },
      );
      const removed = await call(
        workspaceId,
        engineer,
        `/local-tools/channels/${channelId}/messages/${rootId}/reactions/${encodeURIComponent("👀")}`,
        "DELETE",
      );
      assert.equal((removed.value as { removed: boolean }).removed, true);

      const thread = await call(
        workspaceId,
        engineer,
        `/local-tools/channels/${channelId}/messages/${rootId}/replies`,
        "GET",
      );
      assert.deepEqual(
        (thread.value as { messages: { content: string }[] }).messages.map(
          (message) => message.content,
        ),
        [
          `Pressure request ${index}`,
          `I’m checking pressure request ${index} now.`,
          `Pressure request ${index} is verified.`,
        ],
      );
    }

    const foreign = await call(
      "workspace-a",
      { type: "agent", id: "engineer", name: "Engineer" },
      `/local-tools/channels/${channels.get("workspace-b")}/messages`,
      "GET",
    );
    assert.equal(foreign.status, 404);

    await store.close();
    store = new LocalStore(databasePath);
    for (const workspaceId of workspaces) {
      const channelId = channels.get(workspaceId);
      assert.ok(channelId);
      const events = await store.channelStore().events(workspaceId, channelId);
      assert.equal(
        events.filter((event) => event.kind === 7).length,
        ITERATIONS / 2,
      );
      assert.equal(
        events.filter((event) => event.kind === 5).length,
        ITERATIONS / 2,
      );
      assert.equal(
        events.filter((event) => event.kind === 9).length,
        (ITERATIONS / 2) * 3,
      );
    }
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
