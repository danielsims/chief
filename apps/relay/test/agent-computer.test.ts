import type { WorkspaceClient } from "@cloudflare/computer";
import { getWorkspace } from "@cloudflare/computer";
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

let workspace: WorkspaceClient | undefined;

afterEach(() => {
  workspace?.[Symbol.dispose]();
  workspace = undefined;
});

describe("cloud agent computer", () => {
  it("persists files and executes the Worker shell against the same workspace", async () => {
    workspace = await getWorkspace(
      env.AGENTS.get(env.AGENTS.idFromName("computer-files:chief")),
    );
    await workspace.fs.mkdir("/workspace", { recursive: true });
    await workspace.fs.writeFile("/workspace/todo.md", "- [ ] ship Chief\n");

    const run = await workspace.runtime.exec(
      "cat todo.md | tr '[:lower:]' '[:upper:]'",
      { backend: "worker-shell", cwd: "/workspace", encoding: "utf8" },
    );
    const result = await run.result();
    run[Symbol.dispose]();

    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "- [ ] SHIP CHIEF\n",
      stderr: "",
    });
    expect(await workspace.fs.readFile("/workspace/todo.md", "utf8")).toBe(
      "- [ ] ship Chief\n",
    );
  });

  it("persists Git history without a container", async () => {
    workspace = await getWorkspace(
      env.AGENTS.get(env.AGENTS.idFromName("computer-git:chief")),
    );
    await workspace.fs.mkdir("/workspace", { recursive: true });

    const run = await workspace.runtime.exec(
      "git init && printf '# Chief\\n' > README.md && git add README.md && git commit -m 'Initialize agent workspace' && git log --oneline",
      { backend: "worker-shell", cwd: "/workspace", encoding: "utf8" },
    );
    const result = await run.result();
    run[Symbol.dispose]();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Initialize agent workspace");

    const verify = await workspace.runtime.exec("git log --oneline", {
      backend: "worker-shell",
      cwd: "/workspace",
      encoding: "utf8",
    });
    const restored = await verify.result();
    verify[Symbol.dispose]();
    expect(restored.stdout).toContain("Initialize agent workspace");
  });
});
