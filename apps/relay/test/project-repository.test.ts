import { describe, expect, it, vi } from "vitest";

import {
  GitHubProjectRepository,
  githubRepositoryIdentity,
} from "../src/project-repository";

const repository = {
  id: "repository-1",
  projectId: "project-1",
  provider: { provider: "github" as const, owner: "chief", name: "agent" },
  canonicalRemoteUrl: "https://github.com/chief/agent.git",
};

describe("GitHub ProjectRepository", () => {
  it("resolves a requested ref and definition tree to immutable evidence", async () => {
    const request = vi.fn<typeof fetch>(async (input, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer installation-token",
      );
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes("/commits/main"))
        return Response.json({ sha: "a".repeat(40) });
      return Response.json({
        truncated: false,
        tree: [
          { path: "agent", mode: "040000", type: "tree", sha: "b".repeat(40) },
          {
            path: "agent/index.ts",
            mode: "100644",
            type: "blob",
            sha: "c".repeat(40),
          },
          {
            path: "README.md",
            mode: "100644",
            type: "blob",
            sha: "d".repeat(40),
          },
        ],
      });
    });
    const result = await new GitHubProjectRepository(request, {
      installationToken: async () => "installation-token",
    }).resolve(repository, "agent", "main");

    expect(result).toEqual({
      status: "verified",
      resolvedCommitSha: "a".repeat(40),
      contentDigest: expect.stringMatching(/^sha256:[a-f\d]{64}$/u),
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not call GitHub without a relay-scoped installation token", async () => {
    const request = vi.fn<typeof fetch>();
    const result = await new GitHubProjectRepository(request).resolve(
      repository,
      "agent",
      "main",
    );
    expect(result).toEqual({
      status: "unresolved",
      reason: expect.stringContaining("GitHub App"),
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("accepts only canonical GitHub repository URLs", () => {
    expect(
      githubRepositoryIdentity("https://github.com/chief/agent.git"),
    ).toEqual({ provider: "github", owner: "chief", name: "agent" });
    expect(
      githubRepositoryIdentity("https://github.com.evil.test/chief/agent"),
    ).toBeNull();
  });
});
