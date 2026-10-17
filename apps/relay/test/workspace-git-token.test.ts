import { describe, expect, it } from "vitest";

import {
  signWorkspaceGitToken,
  verifyWorkspaceGitToken,
} from "../src/workspace-git-token";

const SECRET = "test-relay-secret";
const input = {
  workspaceId: "workspace-1",
  repo: "acme",
  agentId: "engineer",
};

describe("workspace git token", () => {
  it("round-trips a scoped read token", async () => {
    const { token, expiresAt } = await signWorkspaceGitToken(SECRET, input);
    const verified = await verifyWorkspaceGitToken(SECRET, token);
    expect(verified).toEqual({
      workspaceId: "workspace-1",
      repo: "acme",
      agentId: "engineer",
      scope: "read",
      expiresAt,
    });
  });

  it("rejects a token signed with another key", async () => {
    const { token } = await signWorkspaceGitToken(SECRET, input);
    await expect(
      verifyWorkspaceGitToken("other-secret", token),
    ).rejects.toMatchObject({ code: "git_token_invalid" });
  });

  it("rejects a tampered payload", async () => {
    const { token } = await signWorkspaceGitToken(SECRET, input);
    const [, signature] = token.split(".");
    const forged = btoa(
      JSON.stringify({
        workspaceId: "workspace-1",
        repo: "someone-elses-repo",
        agentId: "engineer",
        scope: "read",
        expiresAt: Date.now() + 60_000,
      }),
    )
      .replace(/=+$/u, "")
      .replace(/\+/gu, "-")
      .replace(/\//gu, "_");
    await expect(
      verifyWorkspaceGitToken(SECRET, `${forged}.${signature}`),
    ).rejects.toMatchObject({ code: "git_token_invalid" });
  });

  it("rejects an expired token", async () => {
    const { token } = await signWorkspaceGitToken(SECRET, input, 0);
    await expect(
      verifyWorkspaceGitToken(SECRET, token, 11 * 60 * 1000),
    ).rejects.toMatchObject({ code: "git_token_invalid" });
  });

  it("rejects a missing token", async () => {
    await expect(verifyWorkspaceGitToken(SECRET, null)).rejects.toMatchObject({
      code: "git_token_invalid",
    });
  });
});
