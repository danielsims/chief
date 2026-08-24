import assert from "node:assert/strict";
import test from "node:test";

import type { CellHarness } from "../src/cells/conformance.js";
import type { CellPersistence } from "../src/cells/sqlite-store.js";
import type { AgentCell } from "../src/cells/types.js";
import {
  CellStoragePersistence,
  CloudflareCell,
  MemoryCellKVStore,
} from "../src/cells/cloudflare.js";
import { runCellConformanceSuite } from "../src/cells/conformance.js";
import { RunLeaseManager } from "../src/cells/leases.js";

const CELL_ID = "workspace-a/engineer/deployment-1";
const OTHER_CELL_ID = "workspace-b/engineer/deployment-1";

function cloudflareHarness(): CellHarness {
  const persistence: CellPersistence = new CellStoragePersistence(
    new MemoryCellKVStore(),
  );
  const leases = new RunLeaseManager(persistence);
  const create = (cellId: string): AgentCell =>
    new CloudflareCell(cellId, persistence);
  return {
    cellId: CELL_ID,
    persistence,
    leases,
    create: () => Promise.resolve(create(CELL_ID)),
    createOtherCell: () => Promise.resolve(create(OTHER_CELL_ID)),
    cleanExpiredProjectLeases: (now) =>
      persistence.cleanExpiredProjectLeases(now),
  };
}

runCellConformanceSuite(() => Promise.resolve(cloudflareHarness()));

void test("the hosted cell keeps repositories out of durable storage", async () => {
  const persistence = new CellStoragePersistence(new MemoryCellKVStore());
  const cell = new CloudflareCell(CELL_ID, persistence);
  const lease = await cell.acquireProject({
    projectId: "project-1",
    agentId: "engineer",
    baseRef: "main",
  });
  assert.equal(lease.projectId, "project-1");
  const stored = await persistence.listOutbox(CELL_ID);
  assert.deepEqual(stored, [], "no repository contents are stored on the cell");
});
