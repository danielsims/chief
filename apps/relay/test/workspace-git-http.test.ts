import { describe, expect, it } from "vitest";

import { buildGitRepository } from "@chief/agent-runtime/git-objects";

import { serveWorkspaceGitHttp } from "../src/workspace-git-http";

async function repositoryFor(files: { path: string; content: string }[]) {
  const repository = await buildGitRepository(files);
  return {
    repository,
    refs: [{ ref: "refs/heads/main", sha: repository.commitSha }],
  };
}

describe("Chief Git smart HTTP", () => {
  it("advertises upload-pack refs for a published tree", async () => {
    const response = await serveWorkspaceGitHttp({
      ...(await repositoryFor([{ path: "README.md", content: "Eve agent\n" }])),
      operation: "git-info-refs",
      service: "git-upload-pack",
    });
    const body = new TextDecoder().decode(await response.arrayBuffer());
    expect(response.headers.get("content-type")).toBe(
      "application/x-git-upload-pack-advertisement",
    );
    expect(body).toContain("# service=git-upload-pack");
    expect(body).toContain("refs/heads/main");
  });

  it("serves a packfile for a clone", async () => {
    const { repository, refs } = await repositoryFor([
      { path: "README.md", content: "Eve agent\n" },
    ]);
    const response = await serveWorkspaceGitHttp({
      repository,
      refs,
      operation: "git-upload-pack",
      body: new TextEncoder().encode(
        `0032want ${repository.commitSha}\n00000009done\n`,
      ),
    });
    const body = new Uint8Array(await response.arrayBuffer());
    expect(response.headers.get("content-type")).toBe(
      "application/x-git-upload-pack-result",
    );
    expect(new TextDecoder().decode(body.slice(0, 8))).toContain("NAK");
  });

  it("does not accept receive-pack", async () => {
    await expect(
      serveWorkspaceGitHttp({
        ...(await repositoryFor([
          { path: "README.md", content: "Eve agent\n" },
        ])),
        operation: "git-receive-pack",
      }),
    ).rejects.toMatchObject({ code: "git_push_disabled" });
  });
});
