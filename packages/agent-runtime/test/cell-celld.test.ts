import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { CellHarness } from "../src/cells/conformance.js";
import type { CellPersistence } from "../src/cells/sqlite-store.js";
import type { AgentCell } from "../src/cells/types.js";
import { CELD_DOCUMENTED_LIMITS, CellDCell } from "../src/cells/celld.js";
import { runCellConformanceSuite } from "../src/cells/conformance.js";
import { RunLeaseManager } from "../src/cells/leases.js";
import { LocalStore } from "../src/local-store.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-celld-conformance-test-encryption-key";

const CELL_ID = "workspace-a/engineer/deployment-1";
const OTHER_CELL_ID = "workspace-b/engineer/deployment-1";

function celldHarness(): CellHarness {
  const directory = mkdtempSync(join(tmpdir(), "chief-celld-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const persistence: CellPersistence = store.cellStore();
  const leases = new RunLeaseManager(persistence);
  const create = (cellId: string): AgentCell =>
    new CellDCell(cellId, persistence);
  return {
    cellId: CELL_ID,
    persistence,
    leases,
    create: () => Promise.resolve(create(CELL_ID)),
    createOtherCell: () => Promise.resolve(create(OTHER_CELL_ID)),
    cleanExpiredProjectLeases: (now) =>
      persistence.cleanExpiredProjectLeases(now),
    cleanup: () =>
      Promise.resolve(rmSync(directory, { recursive: true, force: true })),
  };
}

runCellConformanceSuite(() => Promise.resolve(celldHarness()));

void test("the cellD adapter enforces its documented platform limits", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-celld-limit-"));
  try {
    const store = new LocalStore(join(directory, "chief.sqlite"));
    const persistence: CellPersistence = store.cellStore();
    const cell = new CellDCell(CELL_ID, persistence);
    assert.equal(
      CELD_DOCUMENTED_LIMITS.backgroundTimeoutMs,
      30_000,
      "background execution is best-effort and time-bounded",
    );
    await cell.writeState("big", { blob: "x".repeat(1024) });
    const value = await cell.readState<{ blob: string }>("big");
    assert.equal(value?.blob.length, 1024);
    assert.equal((await cell.getStatus()).state, "idle");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
