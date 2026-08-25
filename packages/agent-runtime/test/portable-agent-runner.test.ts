import assert from "node:assert/strict";
import test from "node:test";

import type { AgentInference } from "@chief/agent-computer";

import { runPortableAgentTurn } from "../src/portable-agent-runner.js";

void test("continues through tool results and returns the final reply", async () => {
  let call = 0;
  const inference: AgentInference = {
    complete: () => {
      call += 1;
      return Promise.resolve(
        call === 1
          ? {
              content: null,
              toolCalls: [
                {
                  id: "tool-1",
                  name: "computer_read_file",
                  arguments: { path: "/workspace/brief.md" },
                },
              ],
            }
          : { content: "The brief says hello.", toolCalls: [] },
      );
    },
  };
  const messages = [{ role: "user" as const, content: "Read the brief." }];

  const reply = await runPortableAgentTurn({
    inference,
    messages,
    tools: [],
    execute: (toolCall) =>
      Promise.resolve({ path: toolCall.name, content: "hello" }),
  });

  assert.equal(reply, "The brief says hello.");
  assert.deepEqual(messages.at(-2), {
    role: "tool",
    toolCallId: "tool-1",
    name: "computer_read_file",
    content: '{"path":"computer_read_file","content":"hello"}',
  });
});

void test("returns tool failures to the model instead of completing the job", async () => {
  let call = 0;
  const inference: AgentInference = {
    complete: () => {
      call += 1;
      return Promise.resolve(
        call === 1
          ? {
              content: null,
              toolCalls: [
                { id: "tool-1", name: "computer_git", arguments: {} },
              ],
            }
          : {
              content: "Git failed because the repository is missing.",
              toolCalls: [],
            },
      );
    },
  };
  const messages = [{ role: "user" as const, content: "Inspect Git." }];

  const reply = await runPortableAgentTurn({
    inference,
    messages,
    tools: [],
    execute: () => Promise.reject(new Error("Repository not found.")),
  });

  assert.equal(reply, "Git failed because the repository is missing.");
  assert.match(messages.at(-2)?.content ?? "", /Repository not found/u);
});

void test("lets an agent work beyond any fixed round count until it answers", async () => {
  // A deliberately long multi-step task: 120 tool rounds before the model
  // produces a final answer. There must be no default round cap.
  let call = 0;
  const inference: AgentInference = {
    complete: () => {
      call += 1;
      const finished = call > 120;
      return Promise.resolve(
        finished
          ? { content: "Done after 120 rounds.", toolCalls: [] }
          : {
              content: null,
              toolCalls: [
                {
                  id: `tool-${call}`,
                  name: "computer_list_files",
                  arguments: {},
                },
              ],
            },
      );
    },
  };
  const messages = [{ role: "user" as const, content: "Do the long work." }];

  const reply = await runPortableAgentTurn({
    inference,
    messages,
    tools: [],
    execute: () => Promise.resolve({ content: "file" }),
  });

  assert.equal(reply, "Done after 120 rounds.");
  assert.ok(call > 120);
});

void test("an explicit maxRounds still caps an intentionally misbehaving agent", async () => {
  let call = 0;
  const inference: AgentInference = {
    complete: () => {
      call += 1;
      return Promise.resolve({
        content: null,
        toolCalls: [
          { id: `tool-${call}`, name: "computer_list_files", arguments: {} },
        ],
      });
    },
  };
  const messages = [{ role: "user" as const, content: "Spin." }];

  await assert.rejects(
    runPortableAgentTurn({
      inference,
      messages,
      tools: [],
      execute: () => Promise.resolve({ content: "file" }),
      maxRounds: 3,
    }),
    /exceeded 3 tool rounds/u,
  );
});
