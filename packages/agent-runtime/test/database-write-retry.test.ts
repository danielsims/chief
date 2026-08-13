import assert from "node:assert/strict";
import test from "node:test";

import { retryDatabaseWrite } from "../src/database-write-retry.js";

void test("database writes recover from transient lock contention", async () => {
  let attempts = 0;
  const result = await retryDatabaseWrite(() => {
    attempts += 1;
    if (attempts < 3) {
      return Promise.reject(new Error("SQLITE_BUSY: database is locked"));
    }
    return Promise.resolve("saved");
  });

  assert.equal(result, "saved");
  assert.equal(attempts, 3);
});

void test("database writes do not retry permanent failures", async () => {
  let attempts = 0;
  await assert.rejects(
    retryDatabaseWrite(() => {
      attempts += 1;
      return Promise.reject(new Error("constraint failed"));
    }),
    /constraint failed/u,
  );
  assert.equal(attempts, 1);
});
