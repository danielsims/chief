import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";

import { downloadVerified } from "../src/drivers/codex-install.js";

void test("Codex setup rejects altered downloads before extraction", async () => {
  const bytes = Buffer.from("verified runtime package");
  const server = createServer((_request, response) => {
    response.end(bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = z.object({ port: z.number() }).parse(server.address());
  const root = await mkdtemp(join(tmpdir(), "chief-codex-integrity-"));
  try {
    const url = `http://127.0.0.1:${address.port}`;
    await assert.rejects(
      downloadVerified(url, "sha512-tampered", join(root, "bad.tgz")),
      /checksum/,
    );
    const digest = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    await downloadVerified(url, digest, join(root, "good.tgz"));
    assert.deepEqual(await readFile(join(root, "good.tgz")), bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
