import assert from "node:assert/strict";
import test from "node:test";

import type {
  ActionItem,
  ChiefUIMessage,
  RecurringWorkRecord,
  SessionRecord,
} from "@chief/agent-runtime/types";

import {
  actionAttentionTarget,
  actionItemsInConversation,
  actionItemsInThread,
  actionItemsNeedingUserInThread,
  channelAttentionTargets,
  channelIdsNeedingUser,
  directMessageAttentionTargets,
  legacyThreadRootIdsNeedingUser,
  threadRootIdsNeedingUser,
} from "../src/lib/channel-action-items";

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

void test("maps a scheduled Chief action to its exact channel thread", () => {
  const actionItem = action("heartbeat-run");
  const heartbeat = {
    ...session(
      "heartbeat-run",
      "channel:workspace-a:mission-control",
      "task",
      "completed",
    ),
    scheduleId: "heartbeat",
    triggerContext: { threadRootId: "heartbeat-thread" },
  };
  const input = {
    actionItems: [actionItem],
    sessions: [heartbeat],
    recurringWork: [],
    channelIds: ["mission-control"],
  };

  assert.deepEqual(
    [...channelAttentionTargets(input)],
    [
      [
        "mission-control",
        { threadRootId: "heartbeat-thread", messageId: actionItem.id },
      ],
    ],
  );
  assert.deepEqual(
    actionAttentionTarget({
      action: actionItem,
      recurringWork: [],
      sessions: [heartbeat],
    }),
    { channelId: "mission-control", threadRootId: "heartbeat-thread" },
  );
  assert.deepEqual(
    [
      ...threadRootIdsNeedingUser({
        actionItems: input.actionItems,
        sessions: input.sessions,
      }),
    ],
    ["heartbeat-thread"],
  );
});

void test("prefers the host-bound action thread over session ancestry", () => {
  const actionItem = {
    ...action("channel:workspace-a:mission-control"),
    threadRootId: "exact-thread",
  };
  const input = {
    actionItems: [actionItem],
    sessions: [],
    recurringWork: [],
    channelIds: ["mission-control"],
  };

  assert.deepEqual(
    [...channelAttentionTargets(input)],
    [
      [
        "mission-control",
        { threadRootId: "exact-thread", messageId: actionItem.id },
      ],
    ],
  );
  assert.deepEqual([...threadRootIdsNeedingUser(input)], ["exact-thread"]);
});

void test("keeps a pre-upgrade channel action discoverable on its latest root", () => {
  const chatId = "channel:workspace-a:mission-control";
  const actionItem = { ...action(chatId), createdAt: 30 };
  const messages = [
    {
      id: "older-root",
      role: "assistant",
      metadata: { createdAt: 10 },
      parts: [],
    },
    {
      id: "heartbeat-root",
      role: "assistant",
      metadata: { createdAt: 20 },
      parts: [],
    },
    {
      id: "later-root",
      role: "user",
      metadata: { createdAt: 40 },
      parts: [],
    },
  ] satisfies ChiefUIMessage[];

  assert.deepEqual(
    [
      ...legacyThreadRootIdsNeedingUser({
        actionItems: [actionItem],
        chatId,
        messages,
      }),
    ],
    ["heartbeat-root"],
  );

  const requestedAction = {
    ...actionItem,
    request: {
      id: "first-move",
      title: "Choose the first move",
      fields: [],
      questions: [
        {
          question: "What should Chief do next?",
          options: [{ label: "Proceed" }, { label: "Wait" }],
        },
      ],
    },
  };
  assert.deepEqual(
    actionItemsNeedingUserInThread({
      actionItems: [requestedAction],
      chatId,
      messages,
      sessions: [],
      threadRootId: "heartbeat-root",
    }).map((item) => item.id),
    [requestedAction.id],
  );
  assert.deepEqual(
    actionItemsInThread({
      actionItems: [
        {
          ...requestedAction,
          status: "resolved",
          threadRootId: "heartbeat-root",
          resolution: {
            answers: { "What should Chief do next?": "Proceed" },
            resolvedAt: 40,
            resolvedBy: { id: "daniel", name: "Daniel Simms" },
          },
        },
      ],
      chatId,
      messages,
      sessions: [],
      threadRootId: "heartbeat-root",
    }).map((item) => item.id),
    [requestedAction.id],
  );
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

void test("shows one durable action card in its owning direct conversation", () => {
  const request = {
    id: "request-colour",
    title: "Choose a colour",
    fields: [],
    questions: [
      {
        question: "Which colour do you like best?",
        options: [{ label: "Blue" }, { label: "Green" }],
      },
    ],
  };
  const openAction = {
    ...action("dm:workspace-a:chief"),
    request,
  };
  const resolvedAction = {
    ...openAction,
    status: "resolved" as const,
    resolution: {
      answers: { "Which colour do you like best?": "Green" },
      resolvedAt: 2,
      resolvedBy: { id: "daniel", name: "Daniel Simms" },
    },
  };

  assert.deepEqual(
    actionItemsInConversation({
      actionItems: [openAction, resolvedAction],
      chatId: "dm:workspace-a:chief",
      sessions: [],
    }).map((item) => item.status),
    ["open", "resolved"],
  );
  assert.deepEqual(
    actionItemsInConversation({
      actionItems: [
        { ...openAction, threadRootId: "thread-a" },
        { ...openAction, sourceId: "dm:workspace-a:marketer" },
      ],
      chatId: "dm:workspace-a:chief",
      sessions: [],
    }),
    [],
  );
});

void test("maps an open direct-message action to its sidebar conversation", () => {
  const actionItem = action(
    "channel:workspace-a:cc7d57ef-d6ea-4ebf-a987-2dc33d18c8c7",
  );
  assert.deepEqual(
    [
      ...directMessageAttentionTargets({
        actionItems: [actionItem],
        sessions: [],
        recurringWork: [],
        directMessageIds: ["chief", "brand"],
        directMessageChats: [
          {
            id: "channel:workspace-a:cc7d57ef-d6ea-4ebf-a987-2dc33d18c8c7",
            agent: "chief",
          },
        ],
      }),
    ],
    [["chief", { messageId: actionItem.id }]],
  );
});

void test("follows a nested session to its direct-message attention target", () => {
  const actionItem = action("nested-direct-task");
  assert.deepEqual(
    [
      ...directMessageAttentionTargets({
        actionItems: [actionItem],
        sessions: [
          session("nested-direct-task", "direct-specialist"),
          session("direct-specialist", "dm:workspace-a:brand"),
        ],
        recurringWork: [],
        directMessageIds: ["chief", "brand"],
      }),
    ],
    [["brand", { messageId: actionItem.id }]],
  );
});

void test("does not mark a resolved direct-message action", () => {
  assert.deepEqual(
    [
      ...directMessageAttentionTargets({
        actionItems: [action("dm:workspace-a:chief", "resolved")],
        sessions: [],
        recurringWork: [],
        directMessageIds: ["chief"],
      }),
    ],
    [],
  );
});
