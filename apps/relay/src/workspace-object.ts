import { DurableObject } from "cloudflare:workers";

import type {
  AuthenticatedIdentity,
  Principal,
  UserPrincipal,
} from "@chief/relay-contracts";
import {
  claimedWorkspaceSchema,
  claimWorkspaceCommandSchema,
  createWorkspaceCommandSchema,
  logBatchSchema,
  workspaceIdSchema,
  workspaceOnboardingResultSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import { HttpError, json, parseJson, relayError } from "./http";
import { readTrustedIdentity } from "./internal-context";
import {
  appendWorkspaceLogs,
  initializeWorkspaceLog,
  readWorkspaceLogs,
} from "./workspace-log-store";

interface MemberRow extends Record<string, SqlStorageValue> {
  principal_kind: AuthenticatedIdentity["kind"];
  principal_id: string;
  role: "owner" | "admin" | "member";
}

interface WorkspaceRow extends Record<string, SqlStorageValue> {
  workspace_id: string;
  name: string;
  created_at: string;
  created_by_user_id: string;
  snapshot_json: string | null;
}

export class WorkspaceObject extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    void state.blockConcurrencyWhile(() => {
      state.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS workspace (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          workspace_id TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          created_by_user_id TEXT NOT NULL,
          snapshot_json TEXT
        );
        CREATE TABLE IF NOT EXISTS members (
          principal_kind TEXT NOT NULL,
          principal_id TEXT NOT NULL,
          role TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (principal_kind, principal_id)
        );
        CREATE TABLE IF NOT EXISTS policy (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL
        );
      `);
      initializeWorkspaceLog(state.storage);
      return Promise.resolve();
    });
  }

  async fetch(request: Request) {
    try {
      const context = readTrustedIdentity(request);
      const operation = request.headers.get("x-chief-internal-operation");
      if (request.method !== "POST") {
        return relayError(405, "method_not_allowed", "Method not allowed.");
      }
      if (operation === "authorize") {
        return this.authorize(context.identity);
      }
      if (operation === "claim") {
        return await this.claim(request, context);
      }
      if (operation === "create-managed") {
        return await this.createManaged(request, context);
      }
      if (operation === "snapshot") {
        return this.snapshot(context);
      }
      if (operation === "complete-onboarding") {
        return await this.completeOnboarding(request, context);
      }
      if (operation === "record-logs") {
        return await this.recordLogs(request);
      }
      if (operation === "list-logs") {
        return this.listLogs(request);
      }
      return relayError(404, "not_found", "Workspace operation not found.");
    } catch (error) {
      if (error instanceof HttpError) {
        return relayError(error.status, error.code, error.message);
      }
      return relayError(
        400,
        "invalid_request",
        "The workspace request is invalid.",
      );
    }
  }

  private authorize(identity: AuthenticatedIdentity) {
    const member = firstRow<MemberRow>(
      this.ctx.storage.sql.exec(
        `SELECT principal_kind, principal_id, role FROM members
         WHERE principal_kind = ? AND principal_id = ?`,
        identity.kind,
        identityId(identity),
      ),
    );
    const workspace = firstRow<WorkspaceRow>(
      this.ctx.storage.sql.exec("SELECT * FROM workspace WHERE singleton = 1"),
    );
    if (!member || !workspace) {
      return relayError(
        403,
        "workspace_access_denied",
        "This identity is not a workspace member.",
      );
    }
    return json({ principal: toPrincipal(identity, member, workspace) });
  }

  private async claim(
    request: Request,
    context: ReturnType<typeof readTrustedIdentity>,
  ) {
    if (context.identity.kind !== "user") {
      return relayError(
        403,
        "workspace_claim_denied",
        "A user identity is required to claim a workspace.",
      );
    }
    const ownerIdentity = context.identity;
    const command = claimWorkspaceCommandSchema.parse(await parseJson(request));
    if (command.workspaceId !== context.workspaceId) {
      return relayError(
        409,
        "workspace_mismatch",
        "The claim was routed to a different workspace.",
      );
    }
    if (!(await matchesBootstrapToken(command.bootstrapToken, this.env))) {
      return relayError(
        403,
        "workspace_claim_denied",
        "The workspace bootstrap token is not valid.",
      );
    }

    const createdAt = new Date().toISOString();
    const inserted = this.ctx.storage.transactionSync(() => {
      const existing = firstRow<WorkspaceRow>(
        this.ctx.storage.sql.exec(
          "SELECT * FROM workspace WHERE singleton = 1",
        ),
      );
      if (existing) return false;
      this.ctx.storage.sql.exec(
        `INSERT INTO workspace (
          singleton, workspace_id, name, created_at, created_by_user_id
        ) VALUES (1, ?, ?, ?, ?)`,
        command.workspaceId,
        command.name,
        createdAt,
        ownerIdentity.userId,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO members (
          principal_kind, principal_id, role, created_at
        ) VALUES ('user', ?, 'owner', ?)`,
        ownerIdentity.userId,
        createdAt,
      );
      return true;
    });
    if (!inserted) {
      return relayError(
        409,
        "workspace_already_claimed",
        "This relay workspace has already been claimed.",
      );
    }

    const principal: UserPrincipal = {
      kind: "user",
      userId: ownerIdentity.userId,
      workspaceId: context.workspaceId,
      role: "owner",
    };
    return json(
      claimedWorkspaceSchema.parse({
        workspaceId: context.workspaceId,
        name: command.name,
        createdAt,
        principal,
      }),
      { status: 201 },
    );
  }

  private async createManaged(
    request: Request,
    context: ReturnType<typeof readTrustedIdentity>,
  ) {
    if (context.identity.kind !== "user") {
      return relayError(403, "user_required", "A user identity is required.");
    }
    const ownerId = context.identity.userId;
    const input = createWorkspaceCommandSchema.parse(await parseJson(request));
    const createdAt = new Date().toISOString();
    const snapshot = workspaceSnapshotSchema.parse({
      id: context.workspaceId,
      name: input.name,
      imageURL: null,
      onboardingComplete: false,
      conversations: [
        {
          id: "general",
          name: "general",
          kind: "channel",
          isPrivate: false,
          unreadCount: 0,
          requiresAttention: false,
          lastMessage: null,
        },
        {
          id: "chief",
          name: "Chief",
          kind: "direct",
          isPrivate: true,
          unreadCount: 0,
          requiresAttention: false,
          lastMessage: null,
        },
      ],
      agents: [
        {
          id: "chief",
          name: "Chief",
          role: "Chief of staff",
          status: "working",
        },
      ],
      projects: [],
      createdAt,
    });
    this.ctx.storage.transactionSync(() => {
      const existing = firstRow<WorkspaceRow>(
        this.ctx.storage.sql.exec(
          "SELECT * FROM workspace WHERE singleton = 1",
        ),
      );
      if (existing) return;
      this.ctx.storage.sql.exec(
        `INSERT INTO workspace (
          singleton, workspace_id, name, created_at, created_by_user_id,
          snapshot_json
        ) VALUES (1, ?, ?, ?, ?, ?)`,
        context.workspaceId,
        input.name,
        createdAt,
        ownerId,
        JSON.stringify(snapshot),
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO members (
          principal_kind, principal_id, role, created_at
        ) VALUES ('user', ?, 'owner', ?)`,
        ownerId,
        createdAt,
      );
    });
    return this.snapshot(context);
  }

  private snapshot(context: ReturnType<typeof readTrustedIdentity>) {
    const workspace = this.requireWorkspace(context.workspaceId);
    this.requireMember(context.identity);
    if (!workspace.snapshot_json) {
      return relayError(
        409,
        "workspace_snapshot_unavailable",
        "This workspace does not expose a managed snapshot.",
      );
    }
    return json(
      workspaceSnapshotSchema.parse(JSON.parse(workspace.snapshot_json)),
    );
  }

  private async completeOnboarding(
    request: Request,
    context: ReturnType<typeof readTrustedIdentity>,
  ) {
    const workspace = this.requireWorkspace(context.workspaceId);
    this.requireMember(context.identity);
    if (!workspace.snapshot_json) {
      throw new HttpError(
        409,
        "workspace_snapshot_unavailable",
        "This workspace does not expose a managed snapshot.",
      );
    }
    const result = workspaceOnboardingResultSchema.parse(
      await parseJson(request),
    );
    const previous = workspaceSnapshotSchema.parse(
      JSON.parse(workspace.snapshot_json),
    );
    const missionControl = previous.conversations.find(
      (conversation) => conversation.id === "mission-control",
    ) ?? {
      id: "mission-control",
      name: "mission-control",
      kind: "channel" as const,
      isPrivate: true,
      unreadCount: 1,
      requiresAttention: false,
      lastMessage: result.openingMessage ?? result.publishedMessage?.body,
    };
    const snapshot = workspaceSnapshotSchema.parse({
      ...previous,
      onboardingComplete: true,
      conversations: [
        missionControl,
        ...previous.conversations.filter(
          (conversation) => conversation.id !== "mission-control",
        ),
      ],
      agents: previous.agents.map((agent) =>
        agent.id === "chief" ? { ...agent, status: "idle" as const } : agent,
      ),
    });
    this.ctx.storage.sql.exec(
      "UPDATE workspace SET snapshot_json = ? WHERE singleton = 1",
      JSON.stringify(snapshot),
    );
    return json(snapshot);
  }

  /**
   * Appends sanitized log records to the workspace's retained log. Inserts
   * are idempotent by log id, so a retried POST never duplicates a record.
   */
  private async recordLogs(request: Request) {
    const context = readTrustedIdentity(request);
    const batch = logBatchSchema.parse(await parseJson(request));
    const workspace = this.requireWorkspace(context.workspaceId);
    this.requireMember(context.identity);
    if (
      batch.logs.some((entry) => entry.workspaceId !== workspace.workspace_id)
    ) {
      return relayError(
        409,
        "workspace_mismatch",
        "Every log must belong to the routed workspace.",
      );
    }
    appendWorkspaceLogs(this.ctx.storage, batch);
    return json({ accepted: batch.logs.length });
  }

  /** Reads the workspace's retained log, newest first, bounded and cursorable. */
  private listLogs(request: Request) {
    const context = readTrustedIdentity(request);
    const workspace = this.requireWorkspace(context.workspaceId);
    this.requireMember(context.identity);
    return json(
      readWorkspaceLogs(
        this.ctx.storage,
        workspaceIdSchema.parse(workspace.workspace_id),
        new URL(request.url),
      ),
    );
  }

  private requireWorkspace(expectedWorkspaceId: string) {
    const workspace = firstRow<WorkspaceRow>(
      this.ctx.storage.sql.exec("SELECT * FROM workspace WHERE singleton = 1"),
    );
    if (!workspace) {
      throw new HttpError(
        404,
        "workspace_not_found",
        "This workspace has not been claimed yet.",
      );
    }
    if (workspace.workspace_id !== expectedWorkspaceId) {
      throw new HttpError(
        409,
        "workspace_mismatch",
        "The request was routed to a different workspace.",
      );
    }
    return workspace;
  }

  private requireMember(identity: AuthenticatedIdentity) {
    const member = firstRow<MemberRow>(
      this.ctx.storage.sql.exec(
        `SELECT principal_kind, principal_id, role FROM members
         WHERE principal_kind = ? AND principal_id = ?`,
        identity.kind,
        identityId(identity),
      ),
    );
    if (!member) {
      throw new HttpError(
        403,
        "workspace_access_denied",
        "This identity is not a workspace member.",
      );
    }
    return member;
  }
}

function identityId(identity: AuthenticatedIdentity) {
  if (identity.kind === "user") return identity.userId;
  if (identity.kind === "agent") return identity.agentId;
  return identity.service;
}

function toPrincipal(
  identity: AuthenticatedIdentity,
  member: MemberRow,
  workspace: WorkspaceRow,
): Principal {
  if (identity.kind === "user") {
    return {
      kind: "user",
      userId: identity.userId,
      workspaceId: workspaceIdSchema.parse(workspace.workspace_id),
      role: member.role,
    };
  }
  if (identity.kind === "agent") {
    return {
      kind: "agent",
      agentId: identity.agentId,
      workspaceId: workspaceIdSchema.parse(workspace.workspace_id),
    };
  }
  return {
    kind: "service",
    service: identity.service,
    workspaceId: workspaceIdSchema.parse(workspace.workspace_id),
  };
}

async function matchesBootstrapToken(token: string, env: Env) {
  const actual = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
  );
  const expected = hexBytes(env.BOOTSTRAP_TOKEN_SHA256);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= (actual[index] ?? 0) ^ (expected[index] ?? 0);
  }
  return difference === 0;
}

function hexBytes(value: string) {
  if (!/^[0-9a-f]{64}$/iu.test(value)) return new Uint8Array();
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}

function firstRow<T>(cursor: Iterable<T>): T | undefined {
  return cursor[Symbol.iterator]().next().value as T | undefined;
}
