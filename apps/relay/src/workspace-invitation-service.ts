import type { AuthenticatedIdentity, Principal } from "@chief/relay-contracts";
import {
  claimWorkspaceInviteCommandSchema,
  createWorkspaceInviteCommandSchema,
  previewWorkspaceInviteCommandSchema,
  workspaceInviteClaimResultSchema,
  workspaceInviteSchema,
} from "@chief/relay-contracts";

import type { WorkspaceRow } from "./workspace-channel-store";
import { HttpError, json, parseJson } from "./http";
import { firstRow, WorkspaceChannelStore } from "./workspace-channel-store";
import { decodeWorkspaceSnapshot } from "./workspace-defaults";

interface InviteRow extends Record<string, SqlStorageValue> {
  invite_id: string;
  secret_hash: string;
  conversation_id: string | null;
  created_by_user_id: string;
  expires_at: string;
  use_count: number;
  revoked_at: string | null;
  created_at: string;
}

interface InviteClaimRow extends Record<string, SqlStorageValue> {
  invite_id: string;
  user_id: string;
  claimed_at: string;
}

const maximumInviteLifetimeMilliseconds = 30 * 24 * 60 * 60 * 1_000;

export class WorkspaceInvitationService {
  private readonly channels: WorkspaceChannelStore;

  constructor(
    private readonly storage: DurableObjectStorage,
    env: Env,
  ) {
    this.channels = new WorkspaceChannelStore(storage, env);
  }

  async create(request: Request, principal: Principal) {
    if (principal.kind !== "user") {
      throw new HttpError(
        403,
        "workspace_invite_denied",
        "Only a workspace owner or admin can invite people.",
      );
    }
    const member = this.channels.requirePrincipalMember(principal);
    if (member.role !== "owner" && member.role !== "admin") {
      throw new HttpError(
        403,
        "workspace_invite_denied",
        "Only a workspace owner or admin can invite people.",
      );
    }
    const command = createWorkspaceInviteCommandSchema.parse(
      await parseJson(request),
    );
    const expiresAt = Date.parse(command.expiresAt);
    const now = Date.now();
    if (
      !Number.isFinite(expiresAt) ||
      expiresAt <= now ||
      expiresAt - now > maximumInviteLifetimeMilliseconds
    ) {
      throw new HttpError(
        400,
        "invalid_invite_expiry",
        "An invite must expire within the next 30 days.",
      );
    }
    if (command.conversationId) {
      this.channels.requireChannel(command.conversationId);
    }
    const secretHash = await hashInviteSecret(command.secret);
    const existing = firstRow<InviteRow>(
      this.storage.sql.exec(
        "SELECT * FROM workspace_invites WHERE invite_id = ?",
        command.commandId,
      ),
    );
    if (existing) {
      if (
        existing.secret_hash !== secretHash ||
        existing.conversation_id !== command.conversationId ||
        existing.expires_at !== command.expiresAt
      ) {
        throw new HttpError(
          409,
          "command_reuse_denied",
          "This command id already belongs to another invite.",
        );
      }
      return json(this.describeInvite(existing));
    }
    try {
      this.storage.sql.exec(
        `INSERT INTO workspace_invites (
          invite_id, secret_hash, conversation_id, created_by_user_id,
          expires_at, use_count, revoked_at, created_at
        ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?)`,
        command.commandId,
        secretHash,
        command.conversationId,
        principal.userId,
        command.expiresAt,
        new Date(now).toISOString(),
      );
    } catch {
      throw new HttpError(
        409,
        "invite_secret_reuse_denied",
        "Generate a fresh invite code.",
      );
    }
    const created = this.requireInvite(command.commandId);
    return json(this.describeInvite(created), { status: 201 });
  }

  async preview(request: Request) {
    const input = previewWorkspaceInviteCommandSchema.parse(
      await parseJson(request),
    );
    const invite = await this.lookupAvailableInvite(input.secret);
    return json(this.describeInvite(invite));
  }

  async claim(request: Request, identity: AuthenticatedIdentity) {
    if (identity.kind !== "user") {
      throw new HttpError(
        403,
        "workspace_invite_denied",
        "A signed-in user is required to join a workspace.",
      );
    }
    const command = claimWorkspaceInviteCommandSchema.parse(
      await parseJson(request),
    );
    const invite = await this.lookupInvite(command.secret);
    const existingClaim = firstRow<InviteClaimRow>(
      this.storage.sql.exec(
        `SELECT * FROM workspace_invite_claims
         WHERE invite_id = ? AND user_id = ?`,
        invite.invite_id,
        identity.userId,
      ),
    );
    const alreadyMember =
      this.channels.memberRole("user", identity.userId) !== null;
    if (!existingClaim) {
      this.requireInviteAvailable(invite);
      const now = new Date().toISOString();
      this.storage.transactionSync(() => {
        this.storage.sql.exec(
          `INSERT INTO members (principal_kind, principal_id, role, created_at)
           VALUES ('user', ?, 'member', ?)
           ON CONFLICT(principal_kind, principal_id) DO NOTHING`,
          identity.userId,
          now,
        );
        const conversationId = invite.conversation_id ?? "general";
        const channel = firstRow<{ conversation_id: string }>(
          this.storage.sql.exec(
            "SELECT conversation_id FROM channels WHERE conversation_id = ?",
            conversationId,
          ),
        );
        if (channel) {
          this.storage.sql.exec(
            `INSERT INTO channel_members (
              conversation_id, principal_kind, principal_id, role, joined_at
            ) VALUES (?, 'user', ?, 'member', ?)
            ON CONFLICT(conversation_id, principal_kind, principal_id) DO NOTHING`,
            conversationId,
            identity.userId,
            now,
          );
        }
        this.storage.sql.exec(
          `INSERT INTO workspace_invite_claims (invite_id, user_id, claimed_at)
           VALUES (?, ?, ?)`,
          invite.invite_id,
          identity.userId,
          now,
        );
        this.storage.sql.exec(
          "UPDATE workspace_invites SET use_count = use_count + 1 WHERE invite_id = ?",
          invite.invite_id,
        );
      });
    }
    return json(
      workspaceInviteClaimResultSchema.parse({
        ...this.describeInvite(invite),
        alreadyMember,
      }),
    );
  }

  joinOrganizationMember(identity: AuthenticatedIdentity) {
    if (identity.kind !== "user") {
      throw new HttpError(
        403,
        "workspace_invite_denied",
        "A signed-in user is required to join a workspace.",
      );
    }
    const now = new Date().toISOString();
    this.storage.transactionSync(() => {
      this.storage.sql.exec(
        `INSERT INTO members (principal_kind, principal_id, role, created_at)
         VALUES ('user', ?, 'member', ?)
         ON CONFLICT(principal_kind, principal_id) DO NOTHING`,
        identity.userId,
        now,
      );
      const general = firstRow<{ conversation_id: string }>(
        this.storage.sql.exec(
          "SELECT conversation_id FROM channels WHERE conversation_id = 'general'",
        ),
      );
      if (general) {
        this.storage.sql.exec(
          `INSERT INTO channel_members (
            conversation_id, principal_kind, principal_id, role, joined_at
          ) VALUES ('general', 'user', ?, 'member', ?)
          ON CONFLICT(conversation_id, principal_kind, principal_id) DO NOTHING`,
          identity.userId,
          now,
        );
      }
    });
    const snapshot = this.workspaceSnapshot();
    return json({
      workspaceId: snapshot.id,
      workspaceName: snapshot.name,
      website: snapshot.website,
    });
  }

  private async lookupAvailableInvite(secret: string) {
    const invite = await this.lookupInvite(secret);
    this.requireInviteAvailable(invite);
    return invite;
  }

  private async lookupInvite(secret: string) {
    const secretHash = await hashInviteSecret(secret);
    const invite = firstRow<InviteRow>(
      this.storage.sql.exec(
        "SELECT * FROM workspace_invites WHERE secret_hash = ?",
        secretHash,
      ),
    );
    if (!invite) {
      throw new HttpError(
        404,
        "workspace_invite_not_found",
        "This workspace invite is not valid.",
      );
    }
    return invite;
  }

  private requireInviteAvailable(invite: InviteRow) {
    if (invite.revoked_at) {
      throw new HttpError(
        410,
        "workspace_invite_revoked",
        "This workspace invite was revoked.",
      );
    }
    if (Date.parse(invite.expires_at) <= Date.now()) {
      throw new HttpError(
        410,
        "workspace_invite_expired",
        "This workspace invite has expired.",
      );
    }
    if (Number(invite.use_count) >= 1) {
      throw new HttpError(
        410,
        "workspace_invite_consumed",
        "This workspace invite has already been used.",
      );
    }
  }

  private requireInvite(inviteId: string) {
    const invite = firstRow<InviteRow>(
      this.storage.sql.exec(
        "SELECT * FROM workspace_invites WHERE invite_id = ?",
        inviteId,
      ),
    );
    if (!invite) throw new Error("The invite was not persisted.");
    return invite;
  }

  private describeInvite(invite: InviteRow) {
    const snapshot = this.workspaceSnapshot();
    const conversation = invite.conversation_id
      ? this.channels.requireChannel(invite.conversation_id)
      : null;
    return workspaceInviteSchema.parse({
      workspaceId: snapshot.id,
      workspaceName: snapshot.name,
      website: snapshot.website,
      conversationId: invite.conversation_id,
      conversationName: conversation ? String(conversation.name) : null,
      expiresAt: invite.expires_at,
    });
  }

  private workspaceSnapshot() {
    const workspace = firstRow<WorkspaceRow>(
      this.storage.sql.exec("SELECT * FROM workspace WHERE singleton = 1"),
    );
    if (!workspace?.snapshot_json) {
      throw new HttpError(
        409,
        "workspace_snapshot_unavailable",
        "This workspace is not ready to accept invitations.",
      );
    }
    return decodeWorkspaceSnapshot(workspace.snapshot_json);
  }
}

async function hashInviteSecret(secret: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
