import { DurableObject } from "cloudflare:workers";

import type { AuthenticatedIdentity } from "@chief/relay-contracts";
import {
  createWorkspaceCommandSchema,
  switchWorkspaceCommandSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { json, parseJson, relayError } from "./http";
import {
  readTrustedAccountIdentity,
  withTrustedIdentity,
} from "./internal-context";

interface DirectoryRow extends Record<string, SqlStorageValue> {
  workspace_id: string;
  command_id: string;
  draft_json: string;
  created_at: string;
  active: number;
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
      if (operation === "list-workspaces") return await this.list(identity);
      if (operation === "switch-workspace") {
        return await this.switchWorkspace(request, identity);
      }
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

  /** List every workspace the account belongs to, with a best-effort snapshot
   * flag so the client can show "finish setup" vs "in". */
  private async list(
    identity: Extract<AuthenticatedIdentity, { kind: "user" }>,
  ) {
    const rows = [
      ...this.ctx.storage.sql.exec<DirectoryRow>(
        "SELECT * FROM workspace_directory ORDER BY created_at ASC",
      ),
    ];
    const workspaces = await Promise.all(
      rows.map(async (row) => {
        const id = workspaceIdSchema.parse(row.workspace_id);
        const entry = toDirectoryEntry(row);
        return {
          id,
          name: entry.command.name,
          isActive: row.active === 1,
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
        "SELECT * FROM workspace_directory WHERE workspace_id = ?",
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
    const changed = this.ctx.storage.transactionSync(() => {
      const current = firstRow<DirectoryRow>(
        this.ctx.storage.sql.exec(
          "SELECT * FROM workspace_directory WHERE active = 1 LIMIT 1",
        ),
      );
      if (current?.workspace_id === target) return false;
      this.ctx.storage.sql.exec(
        "UPDATE workspace_directory SET active = 0 WHERE active = 1",
      );
      this.ctx.storage.sql.exec(
        "UPDATE workspace_directory SET active = 1 WHERE workspace_id = ?",
        target,
      );
      return true;
    });
    void this.maybeRecordMetrics(identity, target);
    return json({ workspaceId: target, isActive: true, changed });
  }

  private async maybeRecordMetrics(
    identity: Extract<AuthenticatedIdentity, { kind: "user" }>,
    workspaceIdValue: string,
  ) {
    try {
      const { recordMetrics } = await import("./metrics");
      recordMetrics(this.env, ["active-workspace"], {
        kind: "user",
        userId: identity.userId,
        pubkey: identity.pubkey,
        workspaceId: workspaceIdSchema.parse(workspaceIdValue),
        role: "owner",
      });
    } catch {
      // Observability only.
    }
  }
}

function workspaceListResult(
  workspaces: {
    id: string;
    name: string;
    isActive: boolean;
    onboardingComplete: boolean;
  }[],
) {
  return { workspaces };
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
