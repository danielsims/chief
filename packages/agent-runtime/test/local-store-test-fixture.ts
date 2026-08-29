import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalStore } from "../src/local-store.js";

export const localStoreTestEncryptionKey =
  "chief-runtime-integration-test-encryption-key";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY = localStoreTestEncryptionKey;

export function localStoreFixture(name: string) {
  const directory = mkdtempSync(join(tmpdir(), `chief-${name}-`));
  const path = join(directory, "chief.sqlite");
  return { directory, path, store: new LocalStore(path) };
}
