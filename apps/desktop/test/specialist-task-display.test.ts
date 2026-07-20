import assert from "node:assert/strict";
import test from "node:test";

import {
  ordinaryToolMessageGroups,
  specialistTaskForInput,
  specialistTaskOwners,
  specialistTasksForInput,
} from "../src/components/chat/specialist-task-display.ts";

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
