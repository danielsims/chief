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

export const hostedComputerTools = [
  defineHostedAgentTool("computer.read", async ({ computer }, input) => ({
    path: requiredString(input, "path"),
    content: boundedOutput(
      await computer.readText(requiredString(input, "path")),
    ),
  })),
  defineHostedAgentTool("computer.list", async ({ computer }, input) => ({
    path: requiredString(input, "path"),
    entries: (await computer.list(requiredString(input, "path"))).slice(0, 500),
  })),
  defineHostedAgentTool("computer.write", async ({ computer }, input) => {
    const path = requiredString(input, "path");
    const content = stringValue(input, "content");
    await computer.writeText(path, content);
    return {
      ok: true,
      path,
      bytesWritten: new TextEncoder().encode(content).length,
    };
  }),
  defineHostedAgentTool("computer.edit", async ({ computer }, input) => {
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
  }),
  defineHostedAgentTool("computer.execute", async ({ computer }, input) =>
    boundedExecution(
      await computer.execute(
        requiredString(input, "command"),
        optionalString(input, "cwd"),
      ),
    ),
  ),
  defineHostedAgentTool("computer.git", async ({ computer }, input) =>
    boundedExecution(
      await computer.git(
        stringArray(input, "argv"),
        optionalString(input, "cwd"),
      ),
    ),
  ),
  defineHostedAgentTool(
    "computer.artifacts.publish",
    async ({ computer, env, job }, input) =>
      await publishAgentArtifact(computer, env, {
        workspaceId: job.workspaceId,
        agentId: job.agentId,
        path: requiredString(input, "path"),
        name: requiredString(input, "name"),
        contentType: requiredString(input, "contentType"),
      }),
  ),
];
