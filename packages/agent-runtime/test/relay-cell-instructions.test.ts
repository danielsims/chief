import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";

import type { LocalCellInstructionContext } from "../src/prompts/local-cell.js";
import {
  localCellExecutionContext,
  localCellInstructions,
} from "../src/prompts/local-cell.js";

function temporaryCell(context: TestContext): LocalCellInstructionContext {
  const root = mkdtempSync(join(tmpdir(), "chief-cell-prompt-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const homeDirectory = join(root, "home");
  const workingDirectory = join(homeDirectory, "cell with spaces");
  mkdirSync(workingDirectory, { recursive: true });
  return {
    identity: "",
    permissions: [],
    conversationKind: "direct",
    workspaceContext: "",
    workingDirectory,
    homeDirectory,
  };
}

void test("local prompt uses supplied directories without granting unavailable tools", (context) => {
  const cell = temporaryCell(context);
  const prompt = localCellInstructions(cell);
  assert.ok(prompt.includes(JSON.stringify(cell.homeDirectory)));
  assert.ok(prompt.includes(JSON.stringify(cell.workingDirectory)));
  assert.doesNotMatch(prompt, /This session's sandbox is the cell directory/u);
  assert.doesNotMatch(prompt, /localTools\.projectsList/u);
  assert.doesNotMatch(prompt, /Use the visible browser/u);
  assert.doesNotMatch(prompt, /CHIEF_INPUT_REQUEST/u);
});

void test("an assigned project is described as the prepared checkout", (context) => {
  const cell = temporaryCell(context);
  const directory = join(cell.homeDirectory, "checkout");
  mkdirSync(directory);
  const instructions = localCellExecutionContext({
    ...cell,
    project: {
      name: basename(directory),
      projectId: "project-under-test",
      directory,
    },
  });
  assert.ok(instructions.includes(JSON.stringify(directory)));
  assert.doesNotMatch(instructions, /No isolated repository checkout/u);
});
