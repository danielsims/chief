import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { relayDatabase } from "../src/db/connection";
import { externalAgentOutbox } from "../src/db/schema/external-agent-outbox";
import { ExternalAgentOutbox } from "../src/external-agent-outbox";
import { relayTestEnv } from "./helpers";
import { withWorkspaceStorage } from "./sqlite-test-storage";

function fixture(storage: DurableObjectStorage, status: string) {
  const now = new Date().toISOString();
  const command = {
    commandId: crypto.randomUUID(),
    protocolVersion: 1,
    occurredAt: now,
    payload: {
      deliveryId: "delivery-1",
      deliveryGeneration: 1,
      sessionAddress: "s".repeat(32),
      continuation: { capability: "c".repeat(43) },
      message: {
        id: crypto.randomUUID(),
        body: "Run once",
        author: { kind: "user", id: "owner" },
        createdAt: now,
      },
    },
  };
  relayDatabase(storage)
    .insert(externalAgentOutbox)
    .values({
      agent_id: "eve",
      delivery_id: "delivery-1",
      payload_hash: "hash",
      payload_json: JSON.stringify(command),
      capability_hash: "capability-hash",
      conversation_id: "general",
      session_address: "s".repeat(32),
      status,
      attempts: 5,
      next_attempt_at: now,
      created_at: now,
      updated_at: now,
    })
    .run();
  return {
    service: new ExternalAgentOutbox(storage, relayTestEnv(), async () => ({
      status: "reconciling",
    })),
    read: () =>
      relayDatabase(storage)
        .select()
        .from(externalAgentOutbox)
        .where(eq(externalAgentOutbox.delivery_id, "delivery-1"))
        .get(),
  };
}

describe("external agent dead-letter recovery", () => {
  it("requeues only a dead delivery, resets attempts, and schedules recovery", async () =>
    withWorkspaceStorage(async (storage) => {
      const { service, read } = fixture(storage, "dead");
      await service.requeue("eve", "delivery-1");
      expect(read()).toMatchObject({
        status: "queued",
        attempts: 0,
        delivering_since: null,
        last_error: null,
      });
      expect(await storage.getAlarm()).not.toBeNull();
    }));

  it.each(["accepted", "retry"])(
    "does not requeue a %s delivery",
    async (status) =>
      withWorkspaceStorage(async (storage) => {
        const { service, read } = fixture(storage, status);
        await expect(
          service.requeue("eve", "delivery-1"),
        ).rejects.toMatchObject({ status: 409 });
        expect(read()?.status).toBe(status);
        expect(await storage.getAlarm()).toBeNull();
      }),
  );
});

describe("ambiguous external delivery reconciliation", () => {
  it("inspects safely without resending after a pre-send process death", async () =>
    withWorkspaceStorage(async (storage) => {
      const { service, read } = fixture(storage, "reconciling");
      await expect(
        service.recover("workspace-1", "eve", "delivery-1", "inspect"),
      ).resolves.toEqual({ status: "reconciling" });
      expect(read()?.status).toBe("reconciling");
      expect(await storage.getAlarm()).toBeNull();
    }));

  it("queues an explicit resend with a new generation", async () =>
    withWorkspaceStorage(async (storage) => {
      const { service, read } = fixture(storage, "reconciling");
      await expect(
        service.recover("workspace-1", "eve", "delivery-1", "resend"),
      ).resolves.toEqual({ status: "resend_queued", deliveryGeneration: 2 });
      const row = read();
      expect(row).toMatchObject({
        status: "queued",
        delivery_generation: 2,
        attempts: 0,
      });
      expect(JSON.parse(row?.payload_json ?? "{}")).toMatchObject({
        payload: { deliveryGeneration: 2 },
      });
      expect(await storage.getAlarm()).not.toBeNull();
    }));

  it("terminally drops an ambiguous delivery without an alarm", async () =>
    withWorkspaceStorage(async (storage) => {
      const { service, read } = fixture(storage, "reconciling");
      await expect(
        service.recover("workspace-1", "eve", "delivery-1", "drop"),
      ).resolves.toEqual({ status: "dropped" });
      expect(read()?.status).toBe("dropped");
      expect(await storage.getAlarm()).toBeNull();
    }));
});
