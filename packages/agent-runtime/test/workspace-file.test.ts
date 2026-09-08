import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  openWithoutSymlinks,
  openWorkspaceFile,
} from "../src/relay-cell/workspace-file.js";

void test("workspace file publishing contains reads and rejects leaf and parent symlink swaps", async () => {
  const temporary = await realpath(
    await mkdtemp(join(tmpdir(), "chief-media-")),
  );
  const root = join(temporary, "workspace");
  const outside = join(temporary, "outside");
  await mkdir(join(root, "reports"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(root, "reports", "report.txt"), "inside");
  await writeFile(join(outside, "report.txt"), "private");
  try {
    const handle = await openWorkspaceFile(root, "reports/report.txt");
    try {
      assert.equal(await handle.readFile("utf8"), "inside");
    } finally {
      await handle.close();
    }
    await assert.rejects(
      openWorkspaceFile(root, "../outside/report.txt"),
      /inside the agent workspace/u,
    );

    // Deterministic swap after path resolution, immediately before the secure open boundary.
    const checked = await realpath(join(root, "reports", "report.txt"));
    await rename(checked, `${checked}.saved`);
    await symlink(join(outside, "report.txt"), checked);
    await assert.rejects(openWithoutSymlinks(checked));
    await assert.rejects(
      openWorkspaceFile(root, "reports/report.txt"),
      /inside the agent workspace/u,
    );
    await rm(checked);
    await rename(`${checked}.saved`, checked);
    await rename(join(root, "reports"), join(root, "saved-reports"));
    await symlink(outside, join(root, "reports"));
    await assert.rejects(openWithoutSymlinks(checked));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
