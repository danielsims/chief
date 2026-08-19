import { DurableObject } from "cloudflare:workers";

import {
  createWorkspaceCommandSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { json, parseJson, relayError } from "./http";
import { readTrustedAccountIdentity } from "./internal-context";

interface DirectoryRow extends Record<string, SqlStorageValue> {
  workspace_id: string;
  command_id: string;
  draft_json: string;
  created_at: string;
}

export class AccountObject extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    void state.blockConcurrencyWhile(() => {
      state.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS workspace_directory (
          workspace_id TEXT PRIMARY KEY,
          command_id TEXT NOT NULL UNIQUE,
          draft_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1
        );
        CREATE UNIQUE INDEX IF NOT EXISTS one_active_workspace
          ON workspace_directory (active) WHERE active = 1;
      `);
      return Promise.resolve();
    });
  }

  async fetch(request: Request) {
    try {
      const identity = readTrustedAccountIdentity(request);
      if (identity.kind !== "user") {
        return relayError(403, "user_required", "A user identity is required.");
      }
      const operation = request.headers.get("x-chief-internal-operation");
      if (request.method !== "POST") {
        return relayError(405, "method_not_allowed", "Method not allowed.");
      }
      if (operation === "create-workspace") return await this.create(request);
      if (operation === "active-workspace") return this.active();
      return relayError(404, "not_found", "Account operation not found.");
    } catch {
      return relayError(
        400,
        "invalid_request",
        "The account request is invalid.",
      );
    }
  }

  private async create(request: Request) {
    const command = createWorkspaceCommandSchema.parse(
      await parseJson(request),
    );
    const prior = firstRow<DirectoryRow>(
      this.ctx.storage.sql.exec(
        "SELECT * FROM workspace_directory WHERE command_id = ?",
        command.commandId,
      ),
    );
    if (prior) return json(toDirectoryEntry(prior));

    const workspaceId = workspaceIdSchema.parse(
      `workspace-${crypto.randomUUID()}`,
    );
    const createdAt = new Date().toISOString();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "UPDATE workspace_directory SET active = 0 WHERE active = 1",
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO workspace_directory (
          workspace_id, command_id, draft_json, created_at, active
        ) VALUES (?, ?, ?, ?, 1)`,
        workspaceId,
        command.commandId,
        JSON.stringify(command),
        createdAt,
      );
    });
    return json({ workspaceId, command, createdAt });
  }

  private active() {
    const row = firstRow<DirectoryRow>(
      this.ctx.storage.sql.exec(
        "SELECT * FROM workspace_directory WHERE active = 1 LIMIT 1",
      ),
    );
    if (!row) return new Response(null, { status: 204 });
    return json(toDirectoryEntry(row));
  }
}

function toDirectoryEntry(row: DirectoryRow) {
  return {
    workspaceId: workspaceIdSchema.parse(row.workspace_id),
    command: createWorkspaceCommandSchema.parse(JSON.parse(row.draft_json)),
    createdAt: String(row.created_at),
  };
}

function firstRow<T>(cursor: Iterable<T>): T | undefined {
  return cursor[Symbol.iterator]().next().value as T | undefined;
}
