import { DurableObject } from "cloudflare:workers";

import { isJsonObject, isJsonString } from "@chief/relay-contracts";

import { json, relayError } from "./http";
import { readTrustedIdentity } from "./internal-context";

interface MetricRow extends Record<string, SqlStorageValue> {
  dimension: string;
  count: number;
}

/**
 * SQLite-backed product-owner metrics store. Records traffic counters
 * (signups, users, DAUs, active workspaces, agents created, messages sent) so
 * a product-owner dashboard can be built on top. Nothing on the request path
 * depends on this object; it is observability only.
 */
export class AnalyticsObject extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    void state.blockConcurrencyWhile(() => {
      state.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS metrics (
          day TEXT NOT NULL,
          dimension TEXT NOT NULL,
          count INTEGER NOT NULL,
          PRIMARY KEY (day, dimension)
        );
      `);
      return Promise.resolve();
    });
  }

  async fetch(request: Request) {
    try {
      const operation = request.headers.get("x-chief-internal-operation");
      if (operation === "record") return await this.record(request);
      if (operation === "aggregate") return this.aggregate(request);
      return relayError(404, "not_found", "Analytics operation not found.");
    } catch {
      return relayError(
        400,
        "invalid_request",
        "The metrics request is invalid.",
      );
    }
  }

  /** Increment per-day counters for a set of dimensions. */
  private async record(request: Request) {
    const parsed: unknown = await request.json();
    const body =
      parsed !== null && isJsonObject(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const at = isJsonString(body.at) ? body.at : undefined;
    const day = (at ?? new Date().toISOString()).slice(0, 10);
    const dimensions = Array.isArray(body.dimensions) ? body.dimensions : [];
    this.ctx.storage.transactionSync(() => {
      for (const dimension of dimensions) {
        if (!isJsonString(dimension) || dimension.length === 0) continue;
        this.ctx.storage.sql.exec(
          `INSERT INTO metrics (day, dimension, count) VALUES (?, ?, 1)
           ON CONFLICT(day, dimension) DO UPDATE SET count = count + 1`,
          day,
          dimension,
        );
      }
    });
    return json({ ok: true });
  }

  /** Return per-dimension totals since a UTC day (inclusive). */
  private aggregate(request: Request) {
    const context = readTrustedIdentity(request);
    if (context.identity.kind !== "user") {
      return relayError(403, "user_required", "A user identity is required.");
    }
    const url = new URL(request.url);
    const since = url.searchParams.get("since") ?? "1970-01-01";
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT dimension, SUM(count) AS count FROM metrics
         WHERE day >= ? GROUP BY dimension ORDER BY dimension`,
        since,
      )
      .toArray() as MetricRow[];
    return json({
      metrics: rows.map((row) => ({
        dimension: String(row.dimension),
        count: Number(row.count),
      })),
    });
  }
}
