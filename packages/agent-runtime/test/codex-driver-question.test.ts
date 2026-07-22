import assert from "node:assert/strict";
import test from "node:test";

import type { AgentEvent } from "../src/types.js";
import { CodexDriver } from "../src/drivers/codex.js";

void test("Codex request_user_input uses Chief's structured question UI", () => {
  const driver = new CodexDriver();
  const events: AgentEvent[] = [];
  const responses: unknown[] = [];
  driver.on("event", (event: AgentEvent) => events.push(event));

  const internals = driver as unknown as {
    handleMessage(message: unknown): void;
    write(message: unknown): void;
  };
  internals.write = (message) => responses.push(message);
  internals.handleMessage({
    id: 41,
    method: "item/tool/requestUserInput",
    params: {
      questions: [
        {
          id: "project",
          header: "Cloud project",
          question: "Which project should own this connection?",
          isOther: true,
          isSecret: false,
          options: [
            { label: "program-video", description: "Program Video" },
            { label: "Create new", description: "Create a project" },
          ],
        },
      ],
    },
  });

  assert.deepEqual(
    events.find((event) => event.type === "question"),
    {
      type: "question",
      requestId: "codex-input-41",
      questions: [
        {
          question: "Which project should own this connection?",
          header: "Cloud project",
          multiSelect: false,
          allowFreeform: true,
          dismissible: false,
          options: [
            { label: "program-video", description: "Program Video" },
            { label: "Create new", description: "Create a project" },
          ],
        },
      ],
    },
  );

  driver.respondQuestion("codex-input-41", {
    "Which project should own this connection?": "program-video",
  });
  assert.deepEqual(responses, [
    {
      jsonrpc: "2.0",
      id: 41,
      result: {
        answers: { project: { answers: ["program-video"] } },
      },
    },
  ]);
});
