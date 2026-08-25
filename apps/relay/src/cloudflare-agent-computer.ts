import type { Workspace } from "@cloudflare/computer";

import type {
  AgentComputer,
  AgentComputerEntry,
  AgentComputerExecution,
} from "@chief/agent-computer";

export class CloudflareAgentComputer implements AgentComputer {
  readonly backend = "cloudflare-worker";

  constructor(private readonly workspace: Workspace) {}

  async readText(path: string) {
    return await this.workspace.fs.readFile(path, "utf8");
  }

  async readBytes(path: string) {
    const stream = await this.workspace.fs.readFile(path);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async writeText(path: string, content: string) {
    await this.ensureParent(path);
    await this.workspace.fs.writeFile(path, content);
  }

  async writeBytes(path: string, content: Uint8Array) {
    await this.ensureParent(path);
    await this.workspace.fs.writeFile(path, content);
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
    const updated = replaceAll
      ? current.split(oldText).join(newText)
      : current.replace(oldText, newText);
    await this.writeText(path, updated);
    return { replacements: replaceAll ? occurrences : 1 };
  }

  async list(path: string): Promise<AgentComputerEntry[]> {
    const entries = await this.workspace.fs.readdir(path);
    return entries.map((entry) => ({
      path: joinPath(path, entry.name),
      kind: entry.isDirectory
        ? "directory"
        : entry.isSymbolicLink
          ? "symlink"
          : "file",
      size: entry.size,
    }));
  }

  async remove(path: string, recursive = false) {
    await this.workspace.fs.rm(path, { recursive });
  }

  async execute(command: string, cwd = "/workspace") {
    const handle = await this.workspace.runtime.exec(command, {
      backend: "worker-shell",
      cwd,
      encoding: "utf8",
      timeoutMs: 120_000,
    });
    try {
      const result = await handle.result();
      return executionResult(result);
    } finally {
      await this.workspace.runtime.disposeExec(handle.id, {
        backend: handle.backend,
      });
    }
  }

  async git(argv: string[], cwd = "/workspace") {
    return await this.workspace.git.cli({ argv, cwd });
  }

  private async ensureParent(path: string) {
    const separator = path.lastIndexOf("/");
    if (separator <= 0) return;
    await this.workspace.fs.mkdir(path.slice(0, separator), {
      recursive: true,
    });
  }
}

function executionResult(result: {
  exitCode: number;
  stdout: string;
  stderr: string;
}): AgentComputerExecution {
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function joinPath(parent: string, child: string) {
  return `${parent.replace(/\/$/u, "")}/${child}`;
}
