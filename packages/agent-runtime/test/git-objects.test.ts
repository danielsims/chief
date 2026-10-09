import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGitRepository,
  gitPackfile,
  gitRemoteUrl,
  gitRepoSlug,
  gitUploadPackAdvertisement,
  gitUploadPackAdvertisementForRefs,
  gitUploadPackResult,
  gitUploadPackWants,
} from "../src/git-objects.js";

void test("builds a stable git commit for the Eve file tree", async () => {
  const first = await buildGitRepository([
    { path: "README.md", content: "Chief\n" },
    { path: "agent/instructions.md", content: "Be useful.\n" },
  ]);
  const second = await buildGitRepository([
    { path: "agent/instructions.md", content: "Be useful.\n" },
    { path: "README.md", content: "Chief\n" },
  ]);
  assert.equal(first.commitSha, second.commitSha);
  assert.match(first.commitSha, /^[a-f0-9]{40}$/u);
  assert.equal(first.objects.length, 5);
});

void test("advertises HEAD and main for git-upload-pack", async () => {
  const repo = await buildGitRepository([
    { path: "README.md", content: "ok\n" },
  ]);
  const body = new TextDecoder().decode(
    gitUploadPackAdvertisement(repo.commitSha),
  );
  assert.match(body, /# service=git-upload-pack/u);
  assert.match(body, new RegExp(`${repo.commitSha} HEAD`, "u"));
  assert.match(body, new RegExp(`${repo.commitSha} refs/heads/main`, "u"));
});

void test("serves a pack for advertised wants", async () => {
  const repo = await buildGitRepository([
    { path: "README.md", content: "ok\n" },
  ]);
  const request = new TextEncoder().encode(
    `0032want ${repo.commitSha}\n00000009done\n`,
  );
  assert.deepEqual(gitUploadPackWants(request), [repo.commitSha]);
  const result = await gitUploadPackResult(repo, request);
  const pack = await gitPackfile(repo);
  assert.equal(new TextDecoder().decode(result.slice(0, 8)), "0008NAK\n");
  assert.deepEqual(result.slice(8), pack);
  assert.equal(new TextDecoder().decode(pack.slice(0, 4)), "PACK");
});

void test("chains a commit onto a parent with a message and author", async () => {
  const first = await buildGitRepository([
    { path: "README.md", content: "v1\n" },
  ]);
  const second = await buildGitRepository(
    [{ path: "README.md", content: "v2\n" }],
    {
      parentSha: first.commitSha,
      message: "Update the readme",
      authorName: "Engineer",
      authorEmail: "engineer@heychief.sh",
      timestamp: 1_700_000_000,
    },
  );
  assert.notEqual(first.commitSha, second.commitSha);
  const commit = second.objects.find(
    (object) => object.type === "commit" && object.sha === second.commitSha,
  );
  assert.ok(commit);
  const payload = new TextDecoder().decode(commit.payload);
  assert.match(payload, new RegExp(`parent ${first.commitSha}`, "u"));
  assert.match(payload, /author Engineer <engineer@heychief\.sh>/u);
  assert.match(payload, /Update the readme/u);
});

void test("advertises multiple refs for git-upload-pack", () => {
  const body = new TextDecoder().decode(
    gitUploadPackAdvertisementForRefs([
      { ref: "refs/heads/main", sha: "a".repeat(40) },
      { ref: "refs/heads/agent", sha: "b".repeat(40) },
    ]),
  );
  assert.match(body, new RegExp(`${"a".repeat(40)} HEAD`, "u"));
  assert.match(body, new RegExp(`${"a".repeat(40)} refs/heads/main`, "u"));
  assert.match(body, new RegExp(`${"b".repeat(40)} refs/heads/agent`, "u"));
});

void test("names the Chief Git remote like Buzz smart HTTP", () => {
  assert.equal(
    gitRemoteUrl("https://relay.example.com", "workspace-1", "acme-chief"),
    "https://relay.example.com/git/workspace-1/acme-chief.git",
  );
  assert.equal(gitRepoSlug("Acme Chief"), "acme-chief");
});
