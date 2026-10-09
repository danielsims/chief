import { RecoverableToolError } from "@chief/agent-runtime/durable-turn";

import { publishAgentArtifact } from "../../agent-artifacts";
import {
  optionalString,
  requiredString,
  stringArray,
  stringValue,
} from "../input";
import { defineHostedAgentTool } from "../tool";

function boundedOutput(value: string) {
  return value.length > 40_000
    ? `${value.slice(0, 40_000)}\n[truncated]`
    : value;
}

function boundedExecution(value: {
  exitCode: number;
  stdout: string;
  stderr: string;
}) {
  return {
    exitCode: value.exitCode,
    stdout: boundedOutput(value.stdout),
    stderr: boundedOutput(value.stderr),
  };
}

const READ_ONLY_GIT = new Set([
  "status",
  "diff",
  "log",
  "show",
  "rev-parse",
  "ls-files",
  "blame",
]);

export const hostedComputerTools = [
  defineHostedAgentTool(
    "computer.read",
    async ({ computer }, input) => ({
      path: requiredString(input, "path"),
      content: boundedOutput(
        await computer.readText(requiredString(input, "path")),
      ),
    }),
    { effect: "read_only", requiresComputer: true },
  ),
  defineHostedAgentTool(
    "computer.list",
    async ({ computer }, input) => ({
      path: requiredString(input, "path"),
      entries: (await computer.list(requiredString(input, "path"))).slice(
        0,
        500,
      ),
    }),
    { effect: "read_only", requiresComputer: true },
  ),
  defineHostedAgentTool(
    "computer.write",
    async ({ computer }, input) => {
      const path = requiredString(input, "path");
      const content = stringValue(input, "content");
      await computer.writeText(path, content);
      return {
        ok: true,
        path,
        bytesWritten: new TextEncoder().encode(content).length,
      };
    },
    { effect: "idempotent", requiresComputer: true },
  ),
  defineHostedAgentTool(
    "computer.edit",
    async ({ computer }, input) => {
      const path = requiredString(input, "path");
      return {
        ok: true,
        path,
        ...(await computer.editText(
          path,
          requiredString(input, "oldText"),
          stringValue(input, "newText"),
          input.replaceAll === true,
        )),
      };
    },
    { effect: "non_replayable", requiresComputer: true },
  ),
  defineHostedAgentTool(
    "computer.execute",
    async ({ computer }, input) =>
      boundedExecution(
        await computer.execute(
          requiredString(input, "command"),
          optionalString(input, "cwd"),
        ),
      ),
    { effect: "non_replayable", requiresComputer: true },
  ),
  defineHostedAgentTool(
    "computer.git",
    async ({ computer }, input) => {
      const argv = stringArray(input, "argv");
      // History lives on the workspace Git host. A local commit, branch or
      // push would create work that exists only on this computer.
      if (!READ_ONLY_GIT.has(argv[0] ?? "")) {
        throw new RecoverableToolError(
          `computer_git only reads Git state (${[...READ_ONLY_GIT].join(", ")}). Record changes with projects_publish.`,
        );
      }
      return boundedExecution(
        await computer.git(argv, optionalString(input, "cwd")),
      );
    },
    { effect: "read_only", requiresComputer: true },
  ),
  defineHostedAgentTool(
    "computer.artifacts.publish",
    async ({ computer, env, job, principal }, input) =>
      await publishAgentArtifact(computer, env, {
        principal,
        conversationId: requiredString(job.payload, "conversationId"),
        path: requiredString(input, "path"),
        name: requiredString(input, "name"),
        contentType: requiredString(input, "contentType"),
      }),
    { effect: "non_replayable", requiresComputer: true },
  ),
];
