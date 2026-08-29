import { z } from "zod";

import type { AgentComputer, AgentComputerEntry } from "@chief/agent-computer";
import {
  execResultSchema,
  executionFileEntrySchema,
} from "@chief/relay-contracts";

import type { RemoteComputerClient } from "./remote-computer-client";

const fileContentSchema = z.object({ contentBase64: z.string() });
const fileListSchema = z.object({
  entries: z.array(executionFileEntrySchema),
});

export class RemoteAgentComputer implements AgentComputer {
  readonly backend = "chief-computer-host";

  constructor(private readonly client: RemoteComputerClient) {}

  async readText(path: string) {
    return new TextDecoder().decode(await this.readBytes(path));
  }

  async readBytes(path: string) {
    const result = await this.client.json("/v1/files/read", fileContentSchema, {
      path: relativeComputerPath(path),
      maxBytes: 10_000_000,
    });
    return Uint8Array.from(atob(result.contentBase64), (character) =>
      character.charCodeAt(0),
    );
  }

  async writeText(path: string, content: string) {
    await this.writeBytes(path, new TextEncoder().encode(content));
  }

  async writeBytes(path: string, content: Uint8Array) {
    let binary = "";
    for (const byte of content) binary += String.fromCharCode(byte);
    await this.client.json("/v1/files/write", z.unknown(), {
      path: relativeComputerPath(path),
      contentBase64: btoa(binary),
      createParents: true,
    });
  }

  async editText(
    path: string,
    oldText: string,
    newText: string,
    replaceAll = false,
  ) {
    if (!oldText) throw new Error("oldText must not be empty.");
    const current = await this.readText(path);
    const occurrences = current.split(oldText).length - 1;
    if (occurrences === 0) throw new Error(`Text was not found in ${path}.`);
    if (!replaceAll && occurrences !== 1) {
      throw new Error(
        `Text appears ${occurrences} times in ${path}; use replaceAll to change every occurrence.`,
      );
    }
    await this.writeText(
      path,
      replaceAll
        ? current.split(oldText).join(newText)
        : current.replace(oldText, newText),
    );
    return { replacements: replaceAll ? occurrences : 1 };
  }

  async list(path: string): Promise<AgentComputerEntry[]> {
    const result = await this.client.json("/v1/files/list", fileListSchema, {
      path: relativeComputerPath(path),
    });
    return result.entries.map((entry) => ({
      ...entry,
      path: absoluteComputerPath(entry.path),
    }));
  }

  async remove(path: string, recursive = false) {
    await this.client.json("/v1/files/remove", z.unknown(), {
      path: relativeComputerPath(path),
      recursive,
    });
  }

  async execute(command: string, cwd = "/workspace") {
    return await this.run(["bash", "-lc", command], cwd);
  }

  async git(argv: string[], cwd = "/workspace") {
    return await this.run(["git", ...argv], cwd);
  }

  private async run(argv: string[], cwd: string) {
    const result = await this.client.json("/v1/exec", execResultSchema, {
      argv,
      cwd: relativeComputerPath(cwd),
      timeoutMillis: 30_000,
    });
    return {
      exitCode: result.exitCode ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}

function relativeComputerPath(path: string) {
  if (path === "/workspace") return ".";
  if (path.startsWith("/workspace/")) return path.slice("/workspace/".length);
  throw new Error("Computer paths must stay inside /workspace.");
}

function absoluteComputerPath(path: string) {
  return path === "." ? "/workspace" : `/workspace/${path}`;
}
