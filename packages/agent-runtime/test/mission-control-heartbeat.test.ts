import assert from "node:assert/strict";
import test from "node:test";

import type { SessionManager } from "../src/manager.js";
import type { RecurringWorkRecord } from "../src/types.js";
import {
  MISSION_CONTROL_HEARTBEAT_OPERATION_KEY,
  syncMissionControlHeartbeat,
} from "../src/mission-control-heartbeat.js";
import { shouldDeliverScheduledOutcomeNotice } from "../src/scheduler.js";

function fixture() {
  let work: RecurringWorkRecord | undefined;
  const rootChats: string[] = [];
  let rootReady = false;
  const manager = {
    agentPreference: () => Promise.resolve({ driver: "codex" }),
    store: {
      channelStore: () => ({
        get: (_workspaceId: string, channelId: string) =>
          Promise.resolve({
            id: channelId,
            name: "mission-control",
            visibility: "public",
            lifecycle: "active",
          }),
      }),
    },
    createRootChat: (_workspaceId: string, chatId: string) => {
      rootChats.push(chatId);
      rootReady = true;
      return Promise.resolve(undefined);
    },
    recurringWorkByOperationKey: (_workspaceId: string, operationKey: string) =>
      Promise.resolve(
        operationKey === MISSION_CONTROL_HEARTBEAT_OPERATION_KEY
          ? work
          : undefined,
      ),
    saveRecurringWork: (_workspaceId: string, next: RecurringWorkRecord) => {
      assert.equal(rootReady, true, "the owning channel chat exists first");
      work = next;
      return Promise.resolve();
    },
  } as unknown as SessionManager;
  return { manager, rootChats, work: () => work };
}

void test("mission control waits for Chief configuration without creating a broken schedule", async () => {
  let saved = false;
  const manager = {
    agentPreference: () => Promise.resolve(undefined),
    recurringWorkByOperationKey: () => Promise.resolve(undefined),
    saveRecurringWork: () => {
      saved = true;
      return Promise.resolve();
    },
  } as unknown as SessionManager;
  await syncMissionControlHeartbeat(manager, "workspace", {
    mode: "mission-control",
    missionControlChannelId: "channel-a",
    updatedAt: 1,
  });
  assert.equal(saved, false);
});

void test("mission control creates one quiet Chief heartbeat", async () => {
  const state = fixture();
  await syncMissionControlHeartbeat(state.manager, "workspace", {
    mode: "mission-control",
    missionControlChannelId: "channel-a",
    updatedAt: 1,
  });
  const heartbeat = state.work();
  assert.ok(heartbeat);
  assert.equal(heartbeat.operationKey, MISSION_CONTROL_HEARTBEAT_OPERATION_KEY);
  assert.equal(heartbeat.agentId, "chief");
  assert.equal(heartbeat.conversationId, "channel:workspace:channel-a");
  assert.deepEqual(state.rootChats, ["channel:workspace:channel-a"]);
  assert.equal(heartbeat.status, "active");
  assert.equal(heartbeat.notificationPolicy, "attention-only");
  assert.deepEqual(heartbeat.proposedToolPatterns, []);
  assert.ok(heartbeat.grant);
  assert.deepEqual(heartbeat.grant.toolPatterns, []);
  assert.deepEqual(heartbeat.grant.localToolPermissions, [
    "workspace.write",
    "channels.read",
    "channels.create",
    "channels.update",
    "channels.archive",
    "members.read",
    "members.manage",
    "messages.read",
    "messages.send",
  ]);
  assert.match(heartbeat.instructions, /not a status reporter/u);
  assert.match(heartbeat.instructions, /no meaningful move/u);
  assert.match(heartbeat.instructions, /Never invent a menu/u);
  assert.match(heartbeat.instructions, /completed onboarding/u);
  assert.match(heartbeat.instructions, /nothing needs the user's attention/u);
  assert.doesNotMatch(heartbeat.instructions, /GitHub|marketing/u);
  assert.equal(
    shouldDeliverScheduledOutcomeNotice(heartbeat, "completed"),
    false,
  );
  assert.equal(shouldDeliverScheduledOutcomeNotice(heartbeat, "failed"), true);
});

void test("turning mission control off pauses rather than deletes the heartbeat", async () => {
  const state = fixture();
  await syncMissionControlHeartbeat(state.manager, "workspace", {
    mode: "mission-control",
    missionControlChannelId: "channel-a",
    updatedAt: 1,
  });
  await syncMissionControlHeartbeat(state.manager, "workspace", {
    mode: "channels",
    missionControlChannelId: "channel-a",
    updatedAt: 2,
  });
  assert.equal(state.work()?.status, "paused");
  assert.equal(state.work()?.nextAt, undefined);
});

void test("mission control preserves an event-driven heartbeat", async () => {
  const state = fixture();
  await syncMissionControlHeartbeat(state.manager, "workspace", {
    mode: "mission-control",
    missionControlChannelId: "channel-a",
    updatedAt: 1,
  });
  const heartbeat = state.work();
  assert.ok(heartbeat);
  await state.manager.saveRecurringWork("workspace", {
    ...heartbeat,
    instructions: "Legacy heartbeat instructions.",
    trigger: { type: "webhook" },
    nextAt: undefined,
  });
  await syncMissionControlHeartbeat(state.manager, "workspace", {
    mode: "mission-control",
    missionControlChannelId: "channel-a",
    updatedAt: 2,
  });
  assert.deepEqual(state.work()?.trigger, { type: "webhook" });
  assert.equal(state.work()?.nextAt, undefined);
  assert.match(state.work()?.instructions ?? "", /Never invent a menu/u);
  assert.doesNotMatch(
    state.work()?.instructions ?? "",
    /Legacy heartbeat instructions/u,
  );
});
