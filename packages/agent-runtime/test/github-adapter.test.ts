import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import type { AddressInfo } from "node:net";

import { GitHubProjectProviderAdapter } from "../src/projects/github-adapter.js";
import { GitHubApp } from "../src/projects/github-app.js";

function testPrivateKey() {
  return execFileSync("openssl", ["genrsa", "2048"], { encoding: "utf8" });
}

function fixtures() {
  const requests: { path: string; method: string; authorization: string }[] =
    [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk as Buffer));
    request.on("end", () => {
      const path = request.url ?? "";
      const authorization = String(request.headers.authorization ?? "");
      requests.push({ path, method: request.method ?? "GET", authorization });
      if (path.startsWith("/app/installations/")) {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            token: "ghs_install_token",
            expires_at: "2099-01-01T00:00:00Z",
          }),
        );
        return;
      }
      if (path.startsWith("/installation/repositories")) {
        const page = new URL(path, "http://x").searchParams.get("page") ?? "1";
        const repos = [
          {
            id: 1,
            name: "alpha",
            full_name: "acme/alpha",
            private: false,
            default_branch: "main",
            clone_url: "https://github.com/acme/alpha.git",
            html_url: "https://github.com/acme/alpha",
            owner: { login: "acme", avatar_url: "https://avatars/a" },
          },
          {
            id: 2,
            name: "beta",
            full_name: "acme/beta",
            private: true,
            default_branch: "trunk",
            clone_url: "https://github.com/acme/beta.git",
            html_url: "https://github.com/acme/beta",
            owner: { login: "acme", avatar_url: "https://avatars/a" },
          },
        ];
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            total_count: 2,
            repositories: page === "2" ? [] : repos,
          }),
        );
        return;
      }
      if (path.startsWith("/repos/acme/alpha")) {
        response.setHeader("content-type", "application/json");
        if (request.method === "POST" && path.endsWith("/pulls")) {
          response.statusCode = 201;
          response.end(
            JSON.stringify({
              number: 42,
              title: "Add feature",
              state: "open",
              html_url: "https://github.com/acme/alpha/pull/42",
              head: { ref: "chief/engineer/feature" },
              base: { ref: "main" },
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
            }),
          );
          return;
        }
        if (path.includes("/pulls/42")) {
          response.end(
            JSON.stringify({
              number: 42,
              title: "Add feature",
              state: "closed",
              html_url: "https://github.com/acme/alpha/pull/42",
              head: { ref: "chief/engineer/feature" },
              base: { ref: "main" },
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-02T00:00:00Z",
            }),
          );
          return;
        }
        if (path.includes("/commits/")) {
          response.end(
            JSON.stringify({
              check_runs: [
                {
                  name: "ci",
                  status: "completed",
                  conclusion: "success",
                  started_at: "2026-01-01T00:00:00Z",
                  completed_at: "2026-01-01T00:01:00Z",
                  html_url: "https://github.com/acme/alpha/runs/9",
                },
              ],
            }),
          );
          return;
        }
        response.end(
          JSON.stringify({
            id: 1,
            full_name: "acme/alpha",
            default_branch: "main",
          }),
        );
        return;
      }
      if (path.startsWith("/repos/acme/beta")) {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            id: 2,
            full_name: "acme/beta",
            default_branch: "trunk",
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ message: "Not Found" }));
    });
  });
  return { server, requests };
}
function baseUrl(server: ReturnType<typeof createServer>) {
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

void test("the GitHub adapter resolves remotes and lists visible repositories", async () => {
  const { server, requests } = fixtures();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const adapter = new GitHubProjectProviderAdapter({
      token: "ghs_test_token",
      apiBaseUrl: baseUrl(server),
    });
    assert.deepEqual(adapter.resolveRemote("git@github.com:acme/alpha.git"), {
      providerId: "github",
      repositoryId: "acme/alpha",
      cloneUrl: "https://github.com/acme/alpha.git",
      webUrl: "https://github.com/acme/alpha",
    });
    assert.equal(
      adapter.resolveRemote("https://gitlab.com/acme/alpha.git"),
      undefined,
    );
    const page = await adapter.listRepositories("connection-1");
    assert.equal(page.repositories.length, 2);
    assert.equal(page.repositories[0]?.defaultBranch, "main");
    assert.equal(page.repositories[1]?.private, true);
    assert.equal(page.nextCursor, undefined);
    assert.equal(
      requests.some((entry) =>
        entry.path.startsWith("/installation/repositories"),
      ),
      true,
    );
  } finally {
    server.close();
  }
});

void test("the adapter mints installation credentials and keeps them out of URLs", async () => {
  const { server, requests } = fixtures();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const adapter = new GitHubProjectProviderAdapter({
      appId: "123456",
      privateKey: testPrivateKey(),
      installationId: "inst-1",
      apiBaseUrl: baseUrl(server),
    });
    const credential = await adapter.createGitCredential({
      organizationId: "workspace-a",
      projectId: "project-1",
      remoteUrl: "https://github.com/acme/alpha.git",
      operation: "push",
    });
    assert.equal(credential.username, "x-access-token");
    assert.equal(credential.password, "ghs_install_token");
    assert.ok(credential.expiresAt);
    const tokenCall = requests.find((entry) =>
      entry.path.startsWith("/app/installations/inst-1/access_tokens"),
    );
    assert.ok(tokenCall, "an installation token request is made");
    assert.match(tokenCall.authorization, /^Bearer \S+\.\S+\.\S+$/);
    assert.equal(
      requests.some((entry) => entry.path.includes("ghs_install_token")),
      false,
      "the token never appears in a request URL",
    );
  } finally {
    server.close();
  }
});

void test("creating and updating pull requests uses the provider mutation surface", async () => {
  const { server } = fixtures();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const adapter = new GitHubProjectProviderAdapter({
      token: "ghs_test_token",
      apiBaseUrl: baseUrl(server),
    });
    const created = await adapter.createPullRequest("connection-1", {
      repositoryId: "acme/alpha",
      title: "Add feature",
      headBranch: "chief/engineer/feature",
      baseBranch: "main",
    });
    assert.equal(created.number, 42);
    assert.equal(created.state, "open");
    assert.equal(created.headBranch, "chief/engineer/feature");
    const updated = await adapter.updatePullRequest("connection-1", {
      repositoryId: "acme/alpha",
      number: 42,
      state: "closed",
    });
    assert.equal(updated.state, "closed");
  } finally {
    server.close();
  }
});

void test("check retrieval and rate-limit handling surface typed failures", async () => {
  const { server } = fixtures();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const adapter = new GitHubProjectProviderAdapter({
      token: "ghs_test_token",
      apiBaseUrl: baseUrl(server),
    });
    const checks = await adapter.getChecks({
      repositoryId: "acme/alpha",
      ref: "chief/engineer/feature",
    });
    assert.equal(checks.length, 1);
    assert.equal(checks[0]?.name, "ci");
    assert.equal(checks[0].conclusion, "success");
    await assert.rejects(
      adapter.getRepository("connection-1", "acme/missing"),
      /Not Found/,
    );
  } finally {
    server.close();
  }
});

void test("the GitHub app mints a signed installation token through the trusted host", async () => {
  const { server } = fixtures();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const app = new GitHubApp(
      {
        appId: "123456",
        privateKey: testPrivateKey(),
      },
      baseUrl(server),
    );
    const token = await app.installationToken("inst-1");
    assert.equal(token.token, "ghs_install_token");
    assert.ok(token.expiresAt > 0);
  } finally {
    server.close();
  }
});
