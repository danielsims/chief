import { describe, expect, it } from "vitest";

import { agentIdSchema } from "@chief/relay-contracts";

import { ExternalAgentOutbox } from "../src/external-agent-outbox";

interface TestSqlRow extends Record<string, SqlStorageValue> {
  agent_id: string;
}

interface TestStoragePort {
  sql: {
    exec(query: string, ...bindings: SqlStorageValue[]): TestSqlRow[];
  };
  setAlarm(value: number): Promise<void>;
}

function outbox(status: "dead" | "accepted" | "retry") {
  const alarms: number[] = [];
  const updates: unknown[][] = [];
  const row = {
    agent_id: "eve",
    delivery_id: "delivery-1",
    payload_hash: "hash",
    payload_json: "{}",
    attempts: 5,
    status,
    delivering_since: null,
  };
  // This focused unit test supplies only the Durable Object methods exercised
  // by requeue; the production adapter provides the complete interface.
  // The test double intentionally implements only the query shapes used by
  // requeue; production supplies Cloudflare's complete SqlStorage contract.
  const sql = {
    exec(query: string, ...bindings: SqlStorageValue[]) {
      if (query.startsWith("SELECT * FROM external_agent_outbox")) return [row];
      if (query.startsWith("UPDATE external_agent_outbox")) {
        updates.push(bindings);
        row.status = "retry";
        row.attempts = 0;
        return [];
      }
      throw new Error(`Unexpected SQL: ${query}`);
    },
  };
  const storage = {
    sql,
    setAlarm(value: number) {
      alarms.push(value);
      return Promise.resolve();
    },
  };
  return {
    alarms,
    updates,
    service: new ExternalAgentOutbox(testStorage(storage), {
      RELAY_SECRET_KEY: "test-relay-secret-master-key-0123456789abcdef",
    } as Env),
  };
}

function testStorage(value: TestStoragePort): DurableObjectStorage {
  // Test boundary: callers construct the exact SQL/alarm subset under test.
  // oxlint-disable-next-line chief/no-chained-type-assertions -- Cloudflare's test runtime interface is intentionally reduced to this focused port.
  return value as unknown as DurableObjectStorage;
}

describe("external agent dead-letter recovery", () => {
  it("requeues only a dead delivery, resets attempts, and schedules one alarm", async () => {
    const fixture = outbox("dead");
    await fixture.service.requeue(agentIdSchema.parse("eve"), "delivery-1");
    expect(fixture.updates).toHaveLength(1);
    expect(fixture.updates[0]?.slice(-2)).toEqual(["eve", "delivery-1"]);
    expect(fixture.alarms).toHaveLength(1);
  });

  it.each(["accepted", "retry"] as const)(
    "does not requeue a %s delivery or schedule an automatic loop",
    async (status) => {
      const fixture = outbox(status);
      await expect(
        fixture.service.requeue(agentIdSchema.parse("eve"), "delivery-1"),
      ).rejects.toMatchObject({ status: 409 });
      expect(fixture.updates).toHaveLength(0);
      expect(fixture.alarms).toHaveLength(0);
    },
  );
});

describe("ambiguous external delivery reconciliation", () => {
  const command = {
    commandId: crypto.randomUUID(),
    protocolVersion: 1 as const,
    occurredAt: new Date().toISOString(),
    payload: {
      deliveryId: "delivery-1",
      deliveryGeneration: 1,
      sessionAddress: "s".repeat(32),
      continuation: { capability: "c".repeat(43) },
      message: {
        id: crypto.randomUUID(),
        body: "Run once",
        author: { kind: "user" as const, id: "owner" },
        createdAt: new Date().toISOString(),
      },
    },
  };

  function reconciliation() {
    const alarms: number[] = [];
    const row = {
      agent_id: "eve",
      delivery_id: "delivery-1",
      payload_hash: "hash",
      payload_json: JSON.stringify(command),
      attempts: 1,
      delivery_generation: 1,
      status: "reconciling",
      delivering_since: null,
    };
    const sql = {
      exec(query: string, ...bindings: SqlStorageValue[]) {
        if (query.startsWith("SELECT * FROM external_agent_outbox"))
          return [row];
        if (query.includes("status = 'dropped'")) row.status = "dropped";
        if (query.includes("status = 'queued'")) {
          row.status = "queued";
          // oxlint-disable-next-line chief/no-ad-hoc-typeof -- focused SQL test boundary validates the serialized bind supplied by the service.
          if (typeof bindings[0] !== "string")
            throw new TypeError("Expected the serialized delivery payload.");
          row.payload_json = bindings[0];
          row.delivery_generation = Number(bindings[1]);
        }
        if (query.includes("status = 'accepted'")) row.status = "accepted";
        return [];
      },
    };
    const storage = testStorage({
      sql,
      setAlarm(value) {
        alarms.push(value);
        return Promise.resolve();
      },
    });
    return {
      alarms,
      row,
      service: new ExternalAgentOutbox(
        storage,
        {
          RELAY_SECRET_KEY: "test-relay-secret-master-key-0123456789abcdef",
        } as Env,
        async () => ({ status: "reconciling" }),
      ),
    };
  }

  it("inspects safely without resending after a pre-send process death", async () => {
    const fixture = reconciliation();
    await expect(
      fixture.service.recover("workspace-1", "eve", "delivery-1", "inspect"),
    ).resolves.toEqual({ status: "reconciling" });
    expect(fixture.row.status).toBe("reconciling");
    expect(fixture.alarms).toHaveLength(0);
  });

  it("queues an explicit resend with a new generation", async () => {
    const fixture = reconciliation();
    await expect(
      fixture.service.recover("workspace-1", "eve", "delivery-1", "resend"),
    ).resolves.toEqual({ status: "resend_queued", deliveryGeneration: 2 });
    expect(fixture.row.status).toBe("queued");
    expect(fixture.row.delivery_generation).toBe(2);
    expect(JSON.parse(fixture.row.payload_json)).toMatchObject({
      payload: { deliveryGeneration: 2 },
    });
    expect(fixture.alarms).toHaveLength(1);
  });

  it("terminally drops an ambiguous delivery without an alarm", async () => {
    const fixture = reconciliation();
    await expect(
      fixture.service.recover("workspace-1", "eve", "delivery-1", "drop"),
    ).resolves.toEqual({ status: "dropped" });
    expect(fixture.row.status).toBe("dropped");
    expect(fixture.alarms).toHaveLength(0);
  });
});
