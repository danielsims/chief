import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("cloud agent computer", () => {
  it("persists files across just-bash executions", async () => {
    const agent = env.AGENTS.get(env.AGENTS.idFromName("computer-files:chief"));
    await agent.executeComputer("printf '%s' '- [ ] ship Chief' > todo.md");
    const result = await agent.executeComputer(
      "cat todo.md | tr '[:lower:]' '[:upper:]'",
    );

    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "- [ ] SHIP CHIEF",
      stderr: "",
    });
    expect((await agent.executeComputer("cat todo.md")).stdout).toBe(
      "- [ ] ship Chief",
    );
  });

  it("persists Git history without a container", async () => {
    const agent = env.AGENTS.get(env.AGENTS.idFromName("computer-git:chief"));
    await agent.executeComputer("printf '# Chief\\n' > README.md");
    expect((await agent.runComputerGit(["init"])).exitCode).toBe(0);
    expect((await agent.runComputerGit(["add", "README.md"])).exitCode).toBe(0);
    const result = await agent.runComputerGit([
      "commit",
      "-m",
      "Initialize agent workspace",
    ]);

    expect(result.exitCode).toBe(0);
    expect((await agent.runComputerGit(["log", "--oneline"])).stdout).toContain(
      "Initialize agent workspace",
    );
  });
});
