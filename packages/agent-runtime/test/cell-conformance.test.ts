import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { CellHarness } from "../src/cells/conformance.js";
import type { CellPersistence } from "../src/cells/sqlite-store.js";
import type { AgentCell } from "../src/cells/types.js";
import { runCellConformanceSuite } from "../src/cells/conformance.js";
import { DesktopAgentCell } from "../src/cells/desktop-cell.js";
import { RunLeaseManager } from "../src/cells/leases.js";
import { TransactionalOutbox } from "../src/cells/outbox.js";
import { LocalStore } from "../src/local-store.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-cell-conformance-test-encryption-key";

const CELL_ID = "workspace-a/engineer/deployment-1";
const OTHER_CELL_ID = "workspace-b/engineer/deployment-1";

function desktopHarness(): CellHarness {
  const directory = mkdtempSync(join(tmpdir(), "chief-cell-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const persistence: CellPersistence = store.cellStore();
  const leases = new RunLeaseManager(persistence);
  const create = (cellId: string): AgentCell =>
    new DesktopAgentCell(cellId, persistence);
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

runCellConformanceSuite(() => Promise.resolve(desktopHarness()));

void test("a desktop cell restart resumes from committed outbox boundaries", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-cell-restart-"));
  try {
    const store = new LocalStore(join(directory, "chief.sqlite"));
    const persistence: CellPersistence = store.cellStore();
    const outbox = new TransactionalOutbox(persistence);
    await outbox.prepare(CELL_ID, {
      idempotencyKey: "restart-effect",
      kind: "message.insert",
    });
    let runs = 0;
    const result = await outbox.deliver(CELL_ID, "restart-effect", () => {
      runs += 1;
    });
    assert.equal(result.recovered, false);
    assert.equal(runs, 1);
    const restarted = new DesktopAgentCell(CELL_ID, persistence);
    const replay = await outbox.deliver(CELL_ID, "restart-effect", () => {
      runs += 1;
    });
    assert.equal(replay.recovered, true);
    assert.equal(runs, 1, "the delivered result is never replayed");
    assert.equal((await restarted.getStatus()).state, "idle");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
