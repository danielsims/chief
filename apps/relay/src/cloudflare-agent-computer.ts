import type { Workspace } from "@cloudflare/computer";
import { Bash, InMemoryFs } from "just-bash";

import type {
  AgentComputer,
  AgentComputerEntry,
  AgentComputerExecution,
} from "@chief/agent-computer";

export class CloudflareAgentComputer implements AgentComputer {
  readonly backend = "cloudflare-just-bash";

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
    const fs = await this.loadShellFileSystem();
    const bash = new Bash({
      fs,
      cwd,
      network: { dangerouslyAllowFullInternetAccess: true },
      executionLimits: { maxExecutionTimeMs: 120_000 },
    });
    const result = await bash.exec(command);
    await this.persistShellFileSystem(fs);
    return executionResult(result);
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

  private async loadShellFileSystem() {
    const fs = new InMemoryFs(undefined, {
      maxTotalBytes: MAX_COMPUTER_BYTES,
    });
    await fs.mkdir("/workspace", { recursive: true });
    await copyWorkspaceToShell(this.workspace, fs, "/workspace");
    return fs;
  }

  private async persistShellFileSystem(fs: InMemoryFs) {
    await this.workspace.fs.rm("/workspace", {
      recursive: true,
      force: true,
    });
    await this.workspace.fs.mkdir("/workspace", { recursive: true });
    const paths = fs
      .getAllPaths()
      .filter((path) => path === "/workspace" || path.startsWith("/workspace/"))
      .sort((left, right) => left.length - right.length);
    for (const path of paths) {
      if (path === "/workspace") continue;
      const stat = await fs.lstat(path);
      if (stat.isDirectory) {
        await this.workspace.fs.mkdir(path, { recursive: true });
      } else if (stat.isSymbolicLink) {
        await this.workspace.fs.symlink(await fs.readlink(path), path);
      } else {
        await this.ensureParent(path);
        await this.workspace.fs.writeFile(path, await fs.readFileBuffer(path));
      }
      await this.workspace.fs.chmod(path, stat.mode);
    }
  }
}

const MAX_COMPUTER_BYTES = 8 * 1_024 * 1_024;

async function copyWorkspaceToShell(
  workspace: Workspace,
  fs: InMemoryFs,
  directory: string,
): Promise<void> {
  const entries = await workspace.fs.readdir(directory).catch(() => []);
  for (const entry of entries) {
    const path = joinPath(directory, entry.name);
    if (entry.isDirectory) {
      await fs.mkdir(path, { recursive: true });
      await copyWorkspaceToShell(workspace, fs, path);
    } else if (entry.isSymbolicLink) {
      await fs.symlink(await workspace.fs.readlink(path), path);
    } else {
      const stream = await workspace.fs.readFile(path);
      await fs.writeFile(
        path,
        new Uint8Array(await new Response(stream).arrayBuffer()),
      );
    }
    const stat = await workspace.fs.lstat(path);
    await fs.chmod(path, stat.mode);
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
