import assert from "node:assert/strict";
import test from "node:test";

import type {
  ActionItem,
  RecurringWorkRecord,
  SessionRecord,
} from "@chief/agent-runtime/types";

import { channelIdsNeedingUser } from "../src/lib/channel-action-items";

function action(
  sourceId: string,
  status: ActionItem["status"] = "open",
): ActionItem {
  return {
    id: `action-${sourceId}`,
    agentId: "chief",
    title: "Continue setup",
    reason: "Sign in to continue this work in the current channel.",
    sourceId,
    status,
    createdAt: 1,
  };
}

function session(
  id: string,
  parentId: string | undefined,
  kind: SessionRecord["kind"] = "task",
  status: SessionRecord["status"] = "waiting",
): SessionRecord {
  return {
    id,
    parentId,
    kind,
    visibility: kind === "conversation" ? "user" : "private",
    agent: "chief",
    title: "Work",
    provider: "codex",
    status,
    attempt: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

void test("marks the channel that owns an open specialist action", () => {
  const result = channelIdsNeedingUser({
    actionItems: [action("specialist-a")],
    sessions: [session("specialist-a", "channel:workspace-a:marketing")],
    recurringWork: [],
    channelIds: ["marketing", "engineering"],
  });

  assert.deepEqual([...result], ["marketing"]);
});

void test("follows nested sessions back to their owning channel", () => {
  const result = channelIdsNeedingUser({
    actionItems: [action("nested-agent")],
    sessions: [
      session("nested-agent", "specialist-a"),
      session("specialist-a", "channel:workspace-a:prospecting"),
    ],
    recurringWork: [],
    channelIds: ["prospecting"],
  });

  assert.deepEqual([...result], ["prospecting"]);
});

void test("marks a channel when its specialist explicitly raises an action", () => {
  const result = channelIdsNeedingUser({
    actionItems: [action("setup-task")],
    sessions: [session("setup-task", "channel:workspace-a:private-setup")],
    recurringWork: [],
    channelIds: ["private-setup", "mission-control"],
  });

  assert.deepEqual([...result], ["private-setup"]);
});

void test("does not infer attention from a waiting session", () => {
  const result = channelIdsNeedingUser({
    actionItems: [],
    sessions: [session("setup-task", "channel:workspace-a:private-setup")],
    recurringWork: [],
    channelIds: ["private-setup"],
  });

  assert.deepEqual([...result], []);
});

void test("maps scheduled actions through their durable conversation", () => {
  const recurringWork = [
    {
      id: "weekly-review",
      conversationId: "channel:workspace-a:mission-control",
    } as RecurringWorkRecord,
  ];
  const result = channelIdsNeedingUser({
    actionItems: [action("automation-weekly-review")],
    sessions: [],
    recurringWork,
    channelIds: ["mission-control"],
  });

  assert.deepEqual([...result], ["mission-control"]);
});

void test("does not mark dismissed, direct-message, or unowned actions", () => {
  const result = channelIdsNeedingUser({
    actionItems: [
      action("dismissed-session", "dismissed"),
      action("dm-session"),
      action("unknown-session"),
    ],
    sessions: [
      session(
        "dismissed-session",
        "channel:workspace-a:marketing",
        "task",
        "completed",
      ),
      session("dm-session", "channel:workspace-a:setup-direct-message"),
    ],
    recurringWork: [],
    channelIds: ["marketing"],
  });

  assert.deepEqual([...result], []);
});
