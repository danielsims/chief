import { describe, expect, it } from "vitest";

import { serveChiefGitHttp } from "../src/chief-git-http";

describe("Chief Git smart HTTP", () => {
  it("advertises upload-pack refs for a published Eve tree", async () => {
    const response = await serveChiefGitHttp({
      files: [{ path: "README.md", content: "Eve agent\n" }],
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

  it("does not accept receive-pack", async () => {
    await expect(
      serveChiefGitHttp({
        files: [{ path: "README.md", content: "Eve agent\n" }],
        operation: "git-receive-pack",
      }),
    ).rejects.toMatchObject({ code: "git_push_disabled" });
  });
});
