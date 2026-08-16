import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { CellPersistence } from "./sqlite-store.js";
import type {
  AgentAlarm,
  AgentCell,
  AgentEvent,
  RunLeaseState,
} from "./types.js";
import { TransactionalOutbox } from "./outbox.js";

/** Run-lease surface the conformance suite drives on any adapter. */
export interface CellRunLeases {
  acquire(
    cellId: string,
    input: { runId: string; agentId: string; ttlMs?: number },
  ): Promise<RunLeaseState>;
  renew(cellId: string, runId: string, ttlMs?: number): Promise<number>;
  release(cellId: string, runId: string): Promise<void>;
  current(cellId: string): Promise<RunLeaseState | undefined>;
  expireStale(now?: number): Promise<number>;
}

export interface CellHarness {
  readonly cellId: string;
  readonly persistence: CellPersistence;
  readonly leases: CellRunLeases;
  /** Fresh adapter instance over the SAME durable storage (simulates restart). */
  create(): Promise<AgentCell>;
  /** A second adapter over the same storage with a different cell identity. */
  createOtherCell(): Promise<AgentCell>;
  cleanExpiredProjectLeases(now: number): Promise<number>;
  cleanup?(): Promise<void>;
}

function event(type: string, idempotencyKey?: string): AgentEvent {
  return {
    id: randomUUID(),
    type,
    idempotencyKey: idempotencyKey ?? randomUUID(),
    createdAt: Date.now(),
  };
}

function outbox(persistence: CellPersistence) {
  return new TransactionalOutbox(persistence);
}

type TestBody = (harness: CellHarness) => Promise<void>;

function conformanceCase(
  factory: () => Promise<CellHarness>,
  name: string,
  body: TestBody,
) {
  void test(name, async () => {
    const harness = await factory();
    try {
      await body(harness);
    } finally {
      await harness.cleanup?.();
    }
  });
}

/** Every cell adapter must pass this suite. */
export function runCellConformanceSuite(factory: () => Promise<CellHarness>) {
  conformanceCase(
    factory,
    "delivers events in a stable order with deduplicated positions",
    async (harness) => {
      const cell = await harness.create();
      const first = event("turn.started", "key-1");
      const second = event("message.posted", "key-2");
      const third = event("message.posted", "key-3");
      const a = await cell.enqueue(first);
      const b = await cell.enqueue(second);
      const c = await cell.enqueue(third);
      assert.equal(a.accepted, true);
      assert.equal(b.accepted, true);
      assert.equal(c.accepted, true);
      assert.equal(a.position < b.position && b.position < c.position, true);
      const replay = await cell.enqueue(second);
      assert.equal(replay.duplicate, true);
      assert.equal(replay.position, b.position);
      const status = await cell.getStatus();
      assert.equal(status.lastEventPosition, c.position);
    },
  );

  conformanceCase(
    factory,
    "rejects duplicate events by idempotency key",
    async (harness) => {
      const cell = await harness.create();
      const key = randomUUID();
      const first = await cell.enqueue(event("turn.started", key));
      const second = await cell.enqueue(event("turn.started", key));
      assert.equal(first.accepted, true);
      assert.equal(second.accepted, false);
      assert.equal(second.duplicate, true);
      assert.equal(second.position, first.position);
      const events = await harness.persistence.events(harness.cellId);
      assert.equal(events.length, 1);
    },
  );

  conformanceCase(
    factory,
    "restart during a model run preserves the run lease and progress",
    async (harness) => {
      const cell = await harness.create();
      const runId = randomUUID();
      await harness.leases.acquire(harness.cellId, {
        runId,
        agentId: "engineer",
        ttlMs: 120_000,
      });
      await cell.writeState("step", 3);
      const restarted = await harness.create();
      const status = await restarted.getStatus();
      assert.equal(status.state, "running");
      assert.equal(status.lease?.runId, runId);
      assert.equal(await restarted.readState<number>("step"), 3);
    },
  );

  conformanceCase(
    factory,
    "outbox recovery delivers a prepared effect exactly once across restart",
    async (harness) => {
      await harness.create();
      const key = randomUUID();
      const prepared = await outbox(harness.persistence).prepare(
        harness.cellId,
        {
          idempotencyKey: key,
          kind: "message.insert",
        },
      );
      assert.equal(prepared.existing, false);

      let runs = 0;
      const delivered = await outbox(harness.persistence).deliver(
        harness.cellId,
        key,
        () => {
          runs += 1;
        },
      );
      assert.equal(delivered.recovered, false);
      assert.equal(runs, 1);

      const replay = await outbox(harness.persistence).deliver(
        harness.cellId,
        key,
        () => {
          runs += 1;
        },
      );
      assert.equal(replay.recovered, true);
      assert.equal(runs, 1, "a delivered effect is never replayed");
      assert.equal(
        await outbox(harness.persistence).state(harness.cellId, key),
        "delivered",
      );
    },
  );

  conformanceCase(
    factory,
    "outbox failures record attempts and recover on retry",
    async (harness) => {
      await harness.create();
      const key = randomUUID();
      const tx = outbox(harness.persistence);
      await tx.prepare(harness.cellId, {
        idempotencyKey: key,
        kind: "message.insert",
      });
      let attempts = 0;
      await assert.rejects(
        tx.deliver(harness.cellId, key, () => {
          attempts += 1;
          throw new Error("transient failure");
        }),
        /transient failure/,
      );
      assert.equal(attempts, 1);
      const delivered = await tx.deliver(harness.cellId, key, () => {
        attempts += 1;
      });
      assert.equal(delivered.recovered, false);
      assert.equal(attempts, 2);
      assert.equal(await tx.state(harness.cellId, key), "delivered");
    },
  );

  conformanceCase(
    factory,
    "delivers due alarms and cancels scheduled ones",
    async (harness) => {
      const cell = await harness.create();
      const due: AgentAlarm = { id: "alarm-1", at: Date.now() - 1_000 };
      const future: AgentAlarm = { id: "alarm-2", at: Date.now() + 60_000 };
      await cell.schedule(due);
      await cell.schedule(future);
      let dueAlarms = await harness.persistence.listDueAlarms(
        harness.cellId,
        Date.now(),
      );
      assert.deepEqual(
        dueAlarms.map((alarm) => alarm.id),
        ["alarm-1"],
      );
      await cell.cancelAlarm("alarm-2");
      await cell.cancelAlarm("alarm-1");
      dueAlarms = await harness.persistence.listDueAlarms(
        harness.cellId,
        Date.now() + 120_000,
      );
      assert.equal(dueAlarms.length, 0);
    },
  );

  conformanceCase(
    factory,
    "an expired run lease yields to a new run and recovers",
    async (harness) => {
      await harness.create();
      await harness.leases.acquire(harness.cellId, {
        runId: "run-stale",
        agentId: "engineer",
        ttlMs: 1,
      });
      await harness.leases.expireStale(Date.now() + 5_000);
      assert.equal(await harness.leases.current(harness.cellId), undefined);
      const fresh = await harness.leases.acquire(harness.cellId, {
        runId: "run-fresh",
        agentId: "engineer",
        ttlMs: 30_000,
      });
      assert.equal(fresh.runId, "run-fresh");
      assert.equal(
        (await harness.leases.current(harness.cellId))?.runId,
        "run-fresh",
      );
    },
  );

  conformanceCase(
    factory,
    "a live run lease blocks a second run and renew keeps ownership",
    async (harness) => {
      await harness.create();
      await harness.leases.acquire(harness.cellId, {
        runId: "run-owner",
        agentId: "engineer",
        ttlMs: 30_000,
      });
      await assert.rejects(
        harness.leases.acquire(harness.cellId, {
          runId: "run-intruder",
          agentId: "engineer",
          ttlMs: 30_000,
        }),
        /another run holds the lease/i,
      );
      const renewed = await harness.leases.renew(harness.cellId, "run-owner");
      assert.ok(renewed > Date.now());
      await assert.rejects(
        harness.leases.renew(harness.cellId, "run-intruder"),
        /lost its lease/,
      );
    },
  );

  conformanceCase(
    factory,
    "project leases are scoped, releasable, and cleaned up when expired",
    async (harness) => {
      const cell = await harness.create();
      const lease = await cell.acquireProject({
        projectId: "project-1",
        agentId: "engineer",
        baseRef: "main",
      });
      assert.equal(lease.projectId, "project-1");
      assert.equal(lease.branch, "main");
      assert.ok(
        await harness.persistence.projectLease(harness.cellId, lease.leaseId),
      );
      await cell.releaseProject(lease.leaseId);
      assert.equal(
        await harness.persistence.projectLease(harness.cellId, lease.leaseId),
        undefined,
      );
      const expired = await cell.acquireProject({
        projectId: "project-2",
        agentId: "engineer",
        ttlMs: 1,
      });
      const cleaned = await harness.cleanExpiredProjectLeases(
        Date.now() + 5_000,
      );
      assert.ok(cleaned >= 1);
      assert.equal(
        await harness.persistence.projectLease(harness.cellId, expired.leaseId),
        undefined,
      );
    },
  );

  conformanceCase(
    factory,
    "workspace isolation keeps events separate per cell identity",
    async (harness) => {
      const cell = await harness.create();
      const other = await harness.createOtherCell();
      await cell.enqueue(event("a.turn", "shared-key"));
      await other.enqueue(event("other.turn", "shared-key"));
      const firstLog = await harness.persistence.events(harness.cellId);
      assert.equal(firstLog.length, 1);
      assert.equal(firstLog[0]?.type, "a.turn");
    },
  );

  conformanceCase(
    factory,
    "bounded replay: duplicate enqueue does not grow the durable log",
    async (harness) => {
      const cell = await harness.create();
      const key = randomUUID();
      for (let index = 0; index < 5; index += 1) {
        await cell.enqueue(event("turn.started", key));
      }
      const events = await harness.persistence.events(harness.cellId);
      assert.equal(events.length, 1);
    },
  );
}
