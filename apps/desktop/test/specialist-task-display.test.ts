import assert from "node:assert/strict";
import test from "node:test";

import {
  chronologicallyMergeSpecialistTasks,
  ordinaryToolMessageGroups,
  specialistNeedsUserInThread,
  specialistTaskBelongsToConversation,
  specialistTaskForInput,
  specialistTaskOwners,
  specialistTasksForInput,
} from "../src/components/chat/specialist-task-display.ts";

void test("specialist cards render only in their owning conversation", () => {
  const task = {
    id: "brand-work",
    agent: "brand",
    parentId: "channel:workspace:marketing",
  };

  assert.equal(
    specialistTaskBelongsToConversation(task, "channel:workspace:marketing"),
    true,
  );
  assert.equal(
    specialistTaskBelongsToConversation(
      task,
      "channel:workspace:mission-control",
    ),
    false,
  );
});

void test("waiting work needs the user only in its owning setup thread", () => {
  const task = {
    id: "setup-work",
    agent: "setup",
    status: "waiting",
    triggerContext: {
      threadRootId: "setup-root",
      originThreadRootId: "mission-root",
    },
  };

  const explicitActions = new Set(["setup-work"]);
  assert.equal(
    specialistNeedsUserInThread(task, "setup-root", explicitActions),
    true,
  );
  assert.equal(
    specialistNeedsUserInThread(task, "mission-root", explicitActions),
    false,
  );
  assert.equal(
    specialistNeedsUserInThread(task, "setup-root", new Set()),
    false,
  );
});

void test("specialist cards keep their chronological place among later messages", () => {
  const messages = [
    { id: "opening", metadata: { createdAt: 100 } },
    { id: "milestone", metadata: { createdAt: 300 } },
    { id: "later-user-message", metadata: { createdAt: 500 } },
  ];
  const tasks = [
    { id: "brand", agent: "brand", createdAt: 400 },
    { id: "prospector", agent: "prospector", createdAt: 200 },
  ];

  assert.deepEqual(
    chronologicallyMergeSpecialistTasks(messages, tasks).map((entry) =>
      entry.type === "message" ? entry.message.id : entry.task.id,
    ),
    ["opening", "prospector", "milestone", "brand", "later-user-message"],
  );
});

void test("one specialist session belongs to its first tool-call message", () => {
  const task = {
    id: "specialist-brand",
    agent: "brand",
    triggerId: "brand-profile-one",
  };
  const calls = [
    ["first", "brand-profile-one"],
    ["second", "business-research"],
    ["third", "working-profile"],
    ["fourth", "research-program"],
  ].map(([id, delegationId]) => ({
    id: id ?? "",
    blocks: [
      {
        type: "tool_use",
        input: {
          code: `await localTools.specialistsDelegate({ agentId: "brand", delegationId: "${delegationId}" })`,
        },
      },
    ],
  }));

  for (const call of calls) {
    assert.equal(specialistTaskForInput(call.blocks[0]?.input, [task]), task);
  }
  assert.deepEqual(
    [...specialistTaskOwners(calls, [task])],
    [["specialist-brand", "first"]],
  );
});

void test("consecutive ordinary tool messages collapse into one owner", () => {
  const messages: {
    id: string;
    role: string;
    blocks: { type: string; input?: unknown }[];
  }[] = [
    {
      id: "one",
      role: "assistant",
      blocks: [{ type: "tool_use", input: { code: "lt.filesList({})" } }],
    },
    {
      id: "two",
      role: "assistant",
      blocks: [{ type: "tool_result", input: undefined }],
    },
    {
      id: "three",
      role: "assistant",
      blocks: [{ type: "text", input: undefined }],
    },
  ];
  const groups = ordinaryToolMessageGroups(messages, []);
  assert.equal(groups.get("one")?.ownerId, "one");
  assert.equal(groups.get("two")?.ownerId, "one");
  assert.equal(groups.get("one")?.blocks.length, 2);
  assert.equal(groups.has("three"), false);
});

void test("reasoning does not split one specialist activity group", () => {
  const messages = [
    {
      id: "one",
      role: "assistant",
      blocks: [
        { type: "thinking" },
        { type: "tool_use", input: { query: "first" } },
      ],
    },
    {
      id: "two",
      role: "assistant",
      blocks: [
        { type: "tool_result" },
        { type: "thinking" },
        { type: "tool_use", input: { query: "second" } },
      ],
    },
  ];

  const groups = ordinaryToolMessageGroups(messages, []);
  assert.equal(groups.get("one")?.ownerId, "one");
  assert.equal(groups.get("two")?.ownerId, "one");
  assert.deepEqual(
    groups.get("one")?.blocks.map((block) => block.type),
    ["tool_use", "tool_result", "tool_use"],
  );
});

void test("agent fallback stays ambiguous when separate tasks exist", () => {
  const tasks = [
    { id: "one", agent: "brand", triggerId: "one" },
    { id: "two", agent: "brand", triggerId: "two" },
  ];
  const input = {
    code: 'await localTools.specialistsDelegate({ agentId: "brand", delegationId: "unknown" })',
  };
  assert.equal(specialistTaskForInput(input, tasks), undefined);
});

void test("one batched tool call owns every distinct specialist task", () => {
  const tasks = [
    {
      id: "brand-task",
      agent: "brand",
      title: "Research the Program brand",
      triggerId: "initial-brand",
    },
    {
      id: "prospector-task",
      agent: "prospector",
      title: "Find qualified prospects",
      triggerId: "initial-prospects",
    },
    {
      id: "setup-task",
      agent: "setup",
      title: "Connect selected sources",
      triggerId: "initial-setup",
    },
  ];
  const input = {
    code: `await Promise.all([
      localTools.specialistsDelegate({ agentId: "brand", delegationId: "initial-brand" }),
      localTools.specialistsDelegate({ agentId: "prospector", delegationId: "initial-prospects" }),
      localTools.specialistsDelegate({ agentId: "setup", delegationId: "initial-setup" }),
      localTools.specialistsDelegate({ agentId: "brand", delegationId: "initial-brand" })
    ])`,
  };

  assert.deepEqual(
    specialistTasksForInput(input, tasks).map((task) => [task.id, task.title]),
    [
      ["brand-task", "Research the Program brand"],
      ["prospector-task", "Find qualified prospects"],
      ["setup-task", "Connect selected sources"],
    ],
  );
  assert.deepEqual(
    [
      ...specialistTaskOwners(
        [{ id: "batched", blocks: [{ type: "tool_use", input }] }],
        tasks,
      ),
    ],
    [
      ["brand-task", "batched"],
      ["prospector-task", "batched"],
      ["setup-task", "batched"],
    ],
  );
});
