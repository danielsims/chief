import assert from "node:assert/strict";
import test from "node:test";

import {
  cellAgentDefinition,
  workspaceAgentRecord,
} from "../src/relay-cell-agent.js";

void test("uses a workspace-authored agent that is not in the bundled roster", () => {
  const definition = cellAgentDefinition("notes", {
    id: "notes",
    name: "Notes",
    role: "Workspace agent",
    description: "Keeps a local running log.",
    instructions: "Capture durable notes on this Mac.",
  });
  assert.equal(definition.id, "notes");
  assert.equal(definition.name, "Notes");
  assert.match(definition.instructions, /durable notes/u);
});

void test("finds a custom specialist under its parent agent", () => {
  const found = workspaceAgentRecord(
    [
      {
        id: "chief",
        name: "Chief",
        role: "Lead",
        description: "",
        instructions: "",
        subagents: [
          {
            id: "notes",
            name: "Notes",
            role: "Specialist",
            description: "",
            instructions: "Stay local.",
          },
        ],
      },
    ],
    "notes",
  );
  assert.equal(found?.id, "notes");
});
