import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";

import type { AuthenticatedIdentity } from "@chief/relay-contracts";
import {
  commandIdSchema,
  createWorkspaceCommandSchema,
  isJsonObject,
  isJsonString,
  switchWorkspaceCommandSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { attempt, runResponse, sync } from "./effect";
import { json, parseJson, relayError } from "./http";
import {
  readTrustedAccountIdentity,
  withTrustedIdentity,
} from "./internal-context";

interface DirectoryRow extends Record<string, SqlStorageValue> {
  workspace_id: string;
  operation_id: string;
  name: string;
  website: string;
  create_command_json: string | null;
  created_at: string;
  active: number;
}

export class AccountObject extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    void state.blockConcurrencyWhile(() => {
      state.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS workspace_directory_v2 (
          workspace_id TEXT PRIMARY KEY,
          operation_id TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          website TEXT NOT NULL DEFAULT '',
          create_command_json TEXT,
          created_at TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1
        );
        CREATE UNIQUE INDEX IF NOT EXISTS one_active_workspace_v2
          ON workspace_directory_v2 (active) WHERE active = 1;
        CREATE TABLE IF NOT EXISTS device_active_workspaces (
          device_pubkey TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      migrateLegacyDirectory(state.storage);
      return Promise.resolve();
    });
  }

  fetch(request: Request) {
    const create = this.create.bind(this);
    const active = this.active.bind(this);
    const list = this.list.bind(this);
    const switchWorkspace = this.switchWorkspace.bind(this);
    const join = this.join.bind(this);
    const remove = this.remove.bind(this);
    const program = Effect.gen(function* () {
      const identity = yield* sync("account.identity", () =>
        readTrustedAccountIdentity(request),
      );
      if (identity.kind !== "user") {
        return relayError(403, "user_required", "A user identity is required.");
      }
      const operation = request.headers.get("x-chief-internal-operation");
      if (request.method !== "POST") {
        return relayError(405, "method_not_allowed", "Method not allowed.");
      }
      if (operation === "create-workspace") {
        return yield* attempt("account.workspace.create", () =>
          create(request, identity),
        );
      }
      if (operation === "active-workspace") {
        return yield* sync("account.workspace.active", () => active(identity));
      }
      if (operation === "list-workspaces") {
        return yield* attempt("account.workspace.list", () => list(identity));
      }
      if (operation === "switch-workspace") {
        return yield* attempt("account.workspace.switch", () =>
          switchWorkspace(request, identity),
        );
      }
      if (operation === "join-workspace") {
        return yield* attempt("account.workspace.join", () =>
          join(request, identity),
        );
      }
      if (operation === "remove-workspace") {
        return yield* attempt("account.workspace.remove", () =>
          remove(request),
        );
      }
      return relayError(404, "not_found", "Account operation not found.");
    });
    return runResponse(program, this.env, { operation: "account.fetch" });
  }

  private async create(
    request: Request,
    identity: Extract<AuthenticatedIdentity, { kind: "user" }>,
  ) {
    const command = createWorkspaceCommandSchema.parse(
      await parseJson(request),
    );
    const prior = firstRow<DirectoryRow>(
      this.ctx.storage.sql.exec(
        "SELECT * FROM workspace_directory_v2 WHERE operation_id = ?",
        command.commandId,
      ),
    );
    if (prior) {
      this.setActiveWorkspace(identity.pubkey, prior.workspace_id);
      return json(toDirectoryEntry(prior));
    }

    const workspaceId = workspaceIdSchema.parse(
      `workspace-${crypto.randomUUID()}`,
    );
    const createdAt = new Date().toISOString();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO workspace_directory_v2 (
          workspace_id, operation_id, name, website, create_command_json,
          created_at, active
        ) VALUES (?, ?, ?, ?, ?, ?, 0)`,
        workspaceId,
        command.commandId,
        command.name,
        command.website,
        JSON.stringify(command),
        createdAt,
      );
      this.setActiveWorkspace(identity.pubkey, workspaceId, createdAt);
    });
    return json({ workspaceId, command, createdAt });
  }

  private active(identity: Extract<AuthenticatedIdentity, { kind: "user" }>) {
    const row = this.activeDirectoryRow(identity.pubkey);
    if (!row) return new Response(null, { status: 204 });
    return json(toDirectoryEntry(row));
  }

  /** List every workspace the account belongs to, with a best-effort snapshot
   * flag so the client can show "finish setup" vs "in". */
  private async list(
    identity: Extract<AuthenticatedIdentity, { kind: "user" }>,
  ) {
    const activeWorkspaceId = this.activeDirectoryRow(
      identity.pubkey,
    )?.workspace_id;
    const rows = [
      ...this.ctx.storage.sql.exec<DirectoryRow>(
        "SELECT * FROM workspace_directory_v2 ORDER BY created_at ASC",
      ),
    ];
    const workspaces = await Promise.all(
      rows.map(async (row) => {
        const id = workspaceIdSchema.parse(row.workspace_id);
        return {
          id,
          name: String(row.name),
          website: String(row.website),
          imageURL: null,
          isActive: row.workspace_id === activeWorkspaceId,
          onboardingComplete: await this.snapshotComplete(identity, id),
        };
      }),
    );
    return json(workspaceListResult(workspaces));
  }

  private async snapshotComplete(
    identity: Extract<AuthenticatedIdentity, { kind: "user" }>,
    workspaceIdValue: string,
  ): Promise<boolean> {
    try {
      const workspaceId = workspaceIdSchema.parse(workspaceIdValue);
      const stub = this.env.WORKSPACES.get(
        this.env.WORKSPACES.idFromName(workspaceId),
      );
      const response = await stub.fetch(
        withTrustedIdentity(
          { identity, requestId: crypto.randomUUID(), workspaceId },
          {
            method: "POST",
            headers: { "x-chief-internal-operation": "snapshot" },
          },
        ),
      );
      if (!response.ok) return false;
      const snapshot: { onboardingComplete?: boolean } = await response.json();
      return snapshot.onboardingComplete === true;
    } catch {
      return false;
    }
  }

  private async switchWorkspace(
    request: Request,
    identity: Extract<AuthenticatedIdentity, { kind: "user" }>,
  ) {
    const command = switchWorkspaceCommandSchema.parse(
      await parseJson(request),
    );
    const target = workspaceIdSchema.parse(command.workspaceId);
    const existing = firstRow<DirectoryRow>(
      this.ctx.storage.sql.exec(
        "SELECT * FROM workspace_directory_v2 WHERE workspace_id = ?",
        target,
      ),
    );
    if (!existing) {
      return relayError(
        404,
        "workspace_not_found",
        "This account does not have that workspace.",
      );
    }
    const current = this.activeDirectoryRow(identity.pubkey);
    if (current?.workspace_id !== target) {
      this.setActiveWorkspace(identity.pubkey, target);
    }
    void this.maybeRecordMetrics();
    return json({ workspaceId: target, isActive: true });
  }

  private async join(
    request: Request,
    identity: Extract<AuthenticatedIdentity, { kind: "user" }>,
  ) {
    const input = parseJson(request).then((value) => {
      if (!isJsonObject(value)) throw new Error("Expected a JSON object.");
      return value;
    });
    const body = await input;
    const workspaceId = workspaceIdSchema.parse(body.workspaceId);
    const operationId = commandIdSchema.parse(body.operationId);
    const name = isJsonString(body.name) ? body.name.trim() : "";
    const website = isJsonString(body.website) ? body.website.trim() : "";
    const createdAt = isJsonString(body.createdAt) ? body.createdAt : "";
    if (!name || name.length > 120 || website.length > 2_048) {
      return relayError(
        400,
        "invalid_workspace",
        "Workspace details are invalid.",
      );
    }
    const existing = firstRow<DirectoryRow>(
      this.ctx.storage.sql.exec(
        "SELECT * FROM workspace_directory_v2 WHERE workspace_id = ?",
        workspaceId,
      ),
    );
    this.ctx.storage.transactionSync(() => {
      if (existing) {
        this.ctx.storage.sql.exec(
          `UPDATE workspace_directory_v2 SET name = ?, website = ?
           WHERE workspace_id = ?`,
          name,
          website,
          workspaceId,
        );
      } else {
        this.ctx.storage.sql.exec(
          `INSERT INTO workspace_directory_v2 (
            workspace_id, operation_id, name, website, create_command_json,
            created_at, active
          ) VALUES (?, ?, ?, ?, NULL, ?, 0)`,
          workspaceId,
          operationId,
          name,
          website,
          createdAt,
        );
      }
      this.setActiveWorkspace(identity.pubkey, workspaceId);
    });
    return json({ workspaceId, isActive: true });
  }

  private async remove(request: Request) {
    const input = await parseJson(request);
    if (!isJsonObject(input)) throw new Error("Expected a JSON object.");
    const workspaceId = workspaceIdSchema.parse(input.workspaceId);
    const existing = firstRow<DirectoryRow>(
      this.ctx.storage.sql.exec(
        "SELECT * FROM workspace_directory_v2 WHERE workspace_id = ?",
        workspaceId,
      ),
    );
    if (!existing) {
      return relayError(
        404,
        "workspace_not_found",
        "This account does not have that workspace.",
      );
    }
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "DELETE FROM device_active_workspaces WHERE workspace_id = ?",
        workspaceId,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM workspace_directory_v2 WHERE workspace_id = ?",
        workspaceId,
      );
    });
    return json({ workspaceId, removed: true });
  }

  private activeDirectoryRow(devicePubkey: string) {
    const selected = firstRow<DirectoryRow>(
      this.ctx.storage.sql.exec(
        `SELECT directory.* FROM workspace_directory_v2 AS directory
         INNER JOIN device_active_workspaces AS active
           ON active.workspace_id = directory.workspace_id
         WHERE active.device_pubkey = ? LIMIT 1`,
        devicePubkey,
      ),
    );
    if (selected) return selected;

    const fallback = firstRow<DirectoryRow>(
      this.ctx.storage.sql.exec(
        `SELECT * FROM workspace_directory_v2
         ORDER BY created_at DESC LIMIT 1`,
      ),
    );
    if (fallback) this.setActiveWorkspace(devicePubkey, fallback.workspace_id);
    return fallback;
  }

  private setActiveWorkspace(
    devicePubkey: string,
    workspaceId: string,
    updatedAt = new Date().toISOString(),
  ) {
    this.ctx.storage.sql.exec(
      `INSERT INTO device_active_workspaces (
        device_pubkey, workspace_id, updated_at
      ) VALUES (?, ?, ?)
      ON CONFLICT(device_pubkey) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        updated_at = excluded.updated_at`,
      devicePubkey,
      workspaceId,
      updatedAt,
    );
  }

  private async maybeRecordMetrics() {
    try {
      const { recordMetrics } = await import("./metrics");
      recordMetrics(this.env, ["active-workspace"]);
    } catch {
      // Observability only.
    }
  }
}

function workspaceListResult(
  workspaces: {
    id: string;
    name: string;
    website: string;
    imageURL: string | null;
    isActive: boolean;
    onboardingComplete: boolean;
  }[],
) {
  return { workspaces };
}

function toDirectoryEntry(row: DirectoryRow) {
  return {
    workspaceId: workspaceIdSchema.parse(row.workspace_id),
    name: String(row.name),
    website: String(row.website),
    command: parseStoredCreateCommand(row.create_command_json),
    createdAt: String(row.created_at),
  };
}

/** Historical onboarding input is optional recovery metadata, not workspace
 * identity. A command written by an earlier app schema must never make the
 * durable workspace directory unreadable. */
function parseStoredCreateCommand(value: string | null) {
  if (!value) return null;
  try {
    const parsed = createWorkspaceCommandSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function migrateLegacyDirectory(storage: DurableObjectStorage) {
  const legacy = storage.sql
    .exec<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspace_directory'",
    )
    .toArray();
  if (legacy.length === 0) return;
  storage.sql.exec(`
    INSERT INTO workspace_directory_v2 (
      workspace_id, operation_id, name, website, create_command_json,
      created_at, active
    )
    SELECT workspace_id, command_id,
      COALESCE(json_extract(draft_json, '$.name'), 'Workspace'),
      COALESCE(json_extract(draft_json, '$.website'), ''),
      draft_json, created_at, active
    FROM workspace_directory
    WHERE true
    ON CONFLICT(workspace_id) DO NOTHING
  `);
}

function firstRow<T>(cursor: Iterable<T>): T | undefined {
  const next = cursor[Symbol.iterator]().next();
  return next.done ? undefined : next.value;
}
