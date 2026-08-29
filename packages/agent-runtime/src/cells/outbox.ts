import { randomUUID } from "node:crypto";

import type { JsonValue } from "@chief/relay-contracts";

import type { CellPersistence } from "./sqlite-store.js";
import type { OutboxRecord, OutboxRecordState } from "./types.js";

export interface OutboxDelivery {
  recovered: boolean;
  deliveredAt: number;
}

export interface OutboxPrepareInput {
  idempotencyKey: string;
  kind: string;
  payload?: JsonValue;
}

/**
 * A transactional outbox. The record is committed BEFORE the tool
 * acknowledges its side effect; a dispatcher performs the effect and marks it
 * delivered. Retries reuse the same idempotency key, so a delivered result is
 * never replayed or replaced by a later false timeout.
 */
export class TransactionalOutbox {
  constructor(private readonly persistence: CellPersistence) {}

  async prepare(
    cellId: string,
    input: OutboxPrepareInput,
  ): Promise<{ record: OutboxRecord; existing: boolean }> {
    const record: OutboxRecord = {
      id: randomUUID(),
      idempotencyKey: input.idempotencyKey,
      kind: input.kind,
      payload: input.payload,
      state: "prepared",
      attempts: 0,
      createdAt: Date.now(),
    };
    const inserted = await this.persistence.prepareOutbox(cellId, record);
    if (inserted) return { record, existing: false };
    const existing = await this.findByKey(cellId, input.idempotencyKey);
    if (!existing) {
      throw new Error("The outbox could not be prepared for delivery.");
    }
    return { record: existing, existing: true };
  }

  /**
   * Delivers one outbox record exactly once. A record already marked
   * delivered is returned as recovered without re-running the effect.
   */
  async deliver(
    cellId: string,
    idempotencyKey: string,
    effect: () => void | Promise<void>,
  ): Promise<OutboxDelivery> {
    const record = await this.findByKey(cellId, idempotencyKey);
    if (!record) {
      throw new Error("No prepared outbox record exists for this key.");
    }
    if (record.state === "delivered") {
      return {
        recovered: true,
        deliveredAt: record.deliveredAt ?? Date.now(),
      };
    }
    try {
      await effect();
    } catch (error) {
      await this.persistence.markOutboxFailed(
        cellId,
        record.id,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
    await this.persistence.markOutboxDelivered(cellId, record.id);
    return { recovered: false, deliveredAt: Date.now() };
  }

  async state(
    cellId: string,
    idempotencyKey: string,
  ): Promise<OutboxRecordState | undefined> {
    return (await this.findByKey(cellId, idempotencyKey))?.state;
  }

  async pending(cellId: string): Promise<OutboxRecord[]> {
    return this.persistence.listOutbox(cellId, ["prepared", "failed"]);
  }

  private async findByKey(cellId: string, idempotencyKey: string) {
    const records = await this.persistence.listOutbox(cellId);
    return records.find((record) => record.idempotencyKey === idempotencyKey);
  }
}
