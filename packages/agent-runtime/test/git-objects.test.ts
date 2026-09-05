import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGitRepository,
  chiefGitRemoteUrl,
  chiefGitRepoSlug,
  gitPackfile,
  gitUploadPackAdvertisement,
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

void test("names the Chief Git remote like Buzz smart HTTP", () => {
  assert.equal(
    chiefGitRemoteUrl(
      "https://relay.example.com",
      "workspace-1",
      "acme-chief",
    ),
    "https://relay.example.com/git/workspace-1/acme-chief.git",
  );
  assert.equal(chiefGitRepoSlug("Acme Chief"), "acme-chief");
});
