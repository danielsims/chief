import { DurableObject } from "cloudflare:workers";

import { hexPubkeySchema, userIdSchema } from "@chief/relay-contracts";

import { json, parseJson, relayError } from "./http";

interface IdentityRow extends Record<string, SqlStorageValue> {
  account_subject: string;
  relay_user_id: string;
  pubkey: string | null;
  created_at: string;
  revoked_at: string | null;
}

/** One small binding cell, addressed either by central account subject or by
 * device pubkey. Account cells choose the canonical relay user once; device
 * cells point independently at it and can later be revoked without moving the
 * account or copying a private key. */
export class IdentityObject extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    void state.blockConcurrencyWhile(() => {
      state.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS identity_binding (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          account_subject TEXT NOT NULL,
          relay_user_id TEXT NOT NULL,
          pubkey TEXT,
          created_at TEXT NOT NULL,
          revoked_at TEXT
        );
      `);
      return Promise.resolve();
    });
  }

  async fetch(request: Request) {
    if (request.method !== "POST") {
      return relayError(405, "method_not_allowed", "Method not allowed.");
    }
    const operation = request.headers.get("x-chief-internal-operation");
    if (operation === "account-resolve-or-create") {
      return await this.accountResolveOrCreate(request);
    }
    if (operation === "device-bind") return await this.deviceBind(request);
    if (operation === "device-resolve") return this.deviceResolve();
    return relayError(404, "not_found", "Identity operation not found.");
  }

  private async accountResolveOrCreate(request: Request) {
    const input = (await parseJson(request)) as {
      accountSubject?: unknown;
      candidateUserId?: unknown;
    };
    const accountSubject = requiredSubject(input.accountSubject);
    const candidateUserId = userIdSchema.parse(input.candidateUserId);
    const existing = firstRow<IdentityRow>(
      this.ctx.storage.sql.exec(
        "SELECT * FROM identity_binding WHERE singleton = 1",
      ),
    );
    if (existing) {
      if (existing.account_subject !== accountSubject) {
        return relayError(
          409,
          "account_binding_conflict",
          "The account binding conflicts.",
        );
      }
      return json({ userId: userIdSchema.parse(existing.relay_user_id) });
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO identity_binding (
        singleton, account_subject, relay_user_id, pubkey, created_at, revoked_at
      ) VALUES (1, ?, ?, NULL, ?, NULL)`,
      accountSubject,
      candidateUserId,
      new Date().toISOString(),
    );
    return json({ userId: candidateUserId });
  }

  private async deviceBind(request: Request) {
    const input = (await parseJson(request)) as {
      accountSubject?: unknown;
      userId?: unknown;
      pubkey?: unknown;
    };
    const accountSubject = requiredSubject(input.accountSubject);
    const userId = userIdSchema.parse(input.userId);
    const pubkey = hexPubkeySchema.parse(input.pubkey);
    const existing = firstRow<IdentityRow>(
      this.ctx.storage.sql.exec(
        "SELECT * FROM identity_binding WHERE singleton = 1",
      ),
    );
    if (existing) {
      if (existing.relay_user_id !== userId || existing.pubkey !== pubkey) {
        return relayError(
          409,
          "device_binding_conflict",
          "This device key is already bound to another account.",
        );
      }
      if (existing.revoked_at) {
        return relayError(
          403,
          "device_key_revoked",
          "This device key was revoked.",
        );
      }
      if (existing.account_subject !== accountSubject) {
        this.ctx.storage.sql.exec(
          "UPDATE identity_binding SET account_subject = ? WHERE singleton = 1",
          accountSubject,
        );
      }
      return json({ userId, pubkey });
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO identity_binding (
        singleton, account_subject, relay_user_id, pubkey, created_at, revoked_at
      ) VALUES (1, ?, ?, ?, ?, NULL)`,
      accountSubject,
      userId,
      pubkey,
      new Date().toISOString(),
    );
    return json({ userId, pubkey }, { status: 201 });
  }

  private deviceResolve() {
    const row = firstRow<IdentityRow>(
      this.ctx.storage.sql.exec(
        "SELECT * FROM identity_binding WHERE singleton = 1",
      ),
    );
    if (!row) return new Response(null, { status: 204 });
    if (row.revoked_at) {
      return relayError(
        403,
        "device_key_revoked",
        "This device key was revoked.",
      );
    }
    return json({
      userId: userIdSchema.parse(row.relay_user_id),
      pubkey: hexPubkeySchema.parse(row.pubkey),
    });
  }
}

function requiredSubject(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 512) {
    throw new Error("Invalid account subject.");
  }
  return value;
}

function firstRow<T>(cursor: Iterable<T>): T | undefined {
  return cursor[Symbol.iterator]().next().value as T | undefined;
}
