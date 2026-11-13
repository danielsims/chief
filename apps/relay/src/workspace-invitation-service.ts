import type { AuthenticatedIdentity, Principal } from "@chief/relay-contracts";
import {
  claimWorkspaceInviteCommandSchema,
  createWorkspaceInviteCommandSchema,
  previewWorkspaceInviteCommandSchema,
  revokeWorkspaceInviteResultSchema,
  workspaceInviteClaimResultSchema,
  workspaceInviteLinkListSchema,
  workspaceInviteSchema,
} from "@chief/relay-contracts";

import type { WorkspaceRow } from "./workspace-channel-store";
import { HttpError, json, parseJson } from "./http";
import { channelMembersInsertClaim } from "./queries/channel-members/insert-claim";
import { channelsFindCreateChannel } from "./queries/channels/find-create-channel";
import { membersInsertClaim } from "./queries/members/insert-claim";
import { workspaceInviteClaimsFindClaim } from "./queries/workspace-invite-claims/find-claim";
import { workspaceInviteClaimsInsertClaim } from "./queries/workspace-invite-claims/insert-claim";
import { workspaceInvitesFindCreate } from "./queries/workspace-invites/find-create";
import { workspaceInvitesFindListOpen } from "./queries/workspace-invites/find-list-open";
import { workspaceInvitesFindLookupInvite } from "./queries/workspace-invites/find-lookup-invite";
import { workspaceInvitesInsertCreate } from "./queries/workspace-invites/insert-create";
import { workspaceInvitesUpdateClaim } from "./queries/workspace-invites/update-claim";
import { workspaceInvitesUpdateRevoke } from "./queries/workspace-invites/update-revoke";
import { workspaceFindAuthorize } from "./queries/workspace/find-authorize";
import { WorkspaceChannelMembership } from "./workspace-channel-membership";
import { firstRow, WorkspaceChannelStore } from "./workspace-channel-store";
import { decodeWorkspaceSnapshot } from "./workspace-defaults";
import {
  memberDisplayNames,
  refreshMemberDisplayNames,
} from "./workspace-member-names";
import { ensureWelcomeChannel } from "./workspace-welcome";

interface InviteRow extends Record<string, SqlStorageValue> {
  invite_id: string;
  secret_hash: string;
  conversation_id: string | null;
  created_by_user_id: string;
  expires_at: string;
  use_count: number;
  revoked_at: string | null;
  created_at: string;
  label: string | null;
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
      workspaceInvitesFindCreate(this.storage, command.commandId),
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
      workspaceInvitesInsertCreate(this.storage, {
        inviteId: command.commandId,
        secretHash: secretHash,
        conversationId: command.conversationId,
        createdByUserId: principal.userId,
        expiresAt: command.expiresAt,
        createdAt: new Date(now).toISOString(),
        label: command.label,
      });
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

  list(principal: Principal) {
    this.requireInviteManager(principal);
    const invites = workspaceInvitesFindListOpen<InviteRow>(
      this.storage,
      new Date().toISOString(),
    );
    return json(
      workspaceInviteLinkListSchema.parse({
        invites: invites.map((invite) => ({
          inviteId: invite.invite_id,
          label: invite.label,
          conversationName: invite.conversation_id
            ? String(this.channels.requireChannel(invite.conversation_id).name)
            : null,
          createdAt: invite.created_at,
          expiresAt: invite.expires_at,
        })),
      }),
    );
  }

  revoke(principal: Principal, inviteId: string) {
    this.requireInviteManager(principal);
    const invite = firstRow<InviteRow>(
      workspaceInvitesFindCreate(this.storage, inviteId),
    );
    if (!invite) {
      throw new HttpError(
        404,
        "workspace_invite_not_found",
        "This workspace invite is not valid.",
      );
    }
    workspaceInvitesUpdateRevoke(
      this.storage,
      inviteId,
      new Date().toISOString(),
    );
    return json(
      revokeWorkspaceInviteResultSchema.parse({ inviteId, revoked: true }),
    );
  }

  private requireInviteManager(principal: Principal) {
    if (principal.kind !== "user") {
      throw new HttpError(
        403,
        "workspace_invite_denied",
        "Only a workspace owner or admin can manage invites.",
      );
    }
    const member = this.channels.requirePrincipalMember(principal);
    if (member.role !== "owner" && member.role !== "admin") {
      throw new HttpError(
        403,
        "workspace_invite_denied",
        "Only a workspace owner or admin can manage invites.",
      );
    }
  }

  async preview(request: Request) {
    const input = previewWorkspaceInviteCommandSchema.parse(
      await parseJson(request),
    );
    const invite = await this.lookupAvailableInvite(input.secret);
    this.requireSetupFinished();
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
    return this.claimForUser(request, identity.userId);
  }

  /** Admits one account. Callers have already authenticated `userId`. */
  async claimForUser(request: Request, userId: string) {
    const command = claimWorkspaceInviteCommandSchema.parse(
      await parseJson(request),
    );
    const invite = await this.lookupInvite(command.secret);
    const existingClaim = firstRow<InviteClaimRow>(
      workspaceInviteClaimsFindClaim(this.storage, invite.invite_id, userId),
    );
    const alreadyMember = this.channels.memberRole("user", userId) !== null;
    if (!existingClaim) {
      this.requireInviteAvailable(invite);
      if (!alreadyMember) this.requireSetupFinished();
      const now = new Date().toISOString();
      const workspaceId = this.workspaceSnapshot().id;
      // Newcomers land in #general; anyone gets the channel the invite names.
      const channels = [
        ...new Set([
          ...(alreadyMember ? [] : ["general"]),
          ...(invite.conversation_id ? [invite.conversation_id] : []),
        ]),
      ];
      const joined = this.storage.transactionSync(() => {
        membersInsertClaim(this.storage, userId, now);
        // Everyone who joins gets their own private Welcome with Chief.
        ensureWelcomeChannel(this.storage, { workspaceId, userId, now });
        const added = channels.filter((conversationId) =>
          this.joinChannel(conversationId, userId, now),
        );
        workspaceInviteClaimsInsertClaim(this.storage, {
          inviteId: invite.invite_id,
          userId: userId,
          claimedAt: now,
        });
        workspaceInvitesUpdateClaim(this.storage, invite.invite_id);
        return added;
      });
      await this.announceJoin(workspaceId, userId, joined, now);
    }
    return json(
      workspaceInviteClaimResultSchema.parse({
        ...this.describeInvite(invite),
        alreadyMember,
      }),
    );
  }

  async joinOrganizationMember(identity: AuthenticatedIdentity) {
    if (identity.kind !== "user") {
      throw new HttpError(
        403,
        "workspace_invite_denied",
        "A signed-in user is required to join a workspace.",
      );
    }
    // Opening a workspace you're already in changes nothing.
    if (this.channels.memberRole("user", identity.userId) === null) {
      this.requireSetupFinished();
      const now = new Date().toISOString();
      const workspaceId = this.workspaceSnapshot().id;
      const joined = this.storage.transactionSync(() => {
        membersInsertClaim(this.storage, identity.userId, now);
        ensureWelcomeChannel(this.storage, {
          workspaceId,
          userId: identity.userId,
          now,
        });
        return this.joinChannel("general", identity.userId, now)
          ? ["general"]
          : [];
      });
      await this.announceJoin(workspaceId, identity.userId, joined, now);
    }
    const snapshot = this.workspaceSnapshot();
    return json({
      workspaceId: snapshot.id,
      workspaceName: snapshot.name,
      website: snapshot.website,
    });
  }

  /** Adds a person to a channel; true only when they weren't in it before. */
  private joinChannel(conversationId: string, userId: string, now: string) {
    if (!firstRow(channelsFindCreateChannel(this.storage, conversationId)))
      return false;
    if (this.channels.channelMembership(conversationId, "user", userId))
      return false;
    channelMembersInsertClaim(this.storage, {
      conversationId,
      principalId: userId,
      joinedAt: now,
    });
    return true;
  }

  /**
   * Posts "Name joined the channel" where a person just arrived. The join has
   * already happened, so a notice that fails to post is logged, not thrown.
   */
  private async announceJoin(
    workspaceId: string,
    userId: string,
    conversationIds: readonly string[],
    now: string,
  ) {
    if (conversationIds.length === 0) return;
    await refreshMemberDisplayNames(this.storage, this.channels.env);
    const name = memberDisplayNames(this.storage).get(`user:${userId}`) ?? "";
    const membership = new WorkspaceChannelMembership(this.channels);
    for (const conversationId of conversationIds) {
      await membership
        .publishMemberJoinedEvent(workspaceId, conversationId, {
          userId,
          name,
          occurredAt: now,
        })
        .catch((error: unknown) => {
          console.error("relay.invitations.join_notice_failed", {
            reason: error instanceof Error ? error.message : "unknown",
          });
        });
    }
  }

  private async lookupAvailableInvite(secret: string) {
    const invite = await this.lookupInvite(secret);
    this.requireInviteAvailable(invite);
    return invite;
  }

  private async lookupInvite(secret: string) {
    const secretHash = await hashInviteSecret(secret);
    const invite = firstRow<InviteRow>(
      workspaceInvitesFindLookupInvite(this.storage, secretHash),
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

  /** Nobody joins until the owner has finished setting the workspace up. */
  private requireSetupFinished() {
    if (this.workspaceSnapshot().setupComplete === false) {
      throw new HttpError(
        409,
        "workspace_unavailable",
        "This workspace isn’t available yet. Contact the workspace owner.",
      );
    }
  }

  private requireInvite(inviteId: string) {
    const invite = firstRow<InviteRow>(
      workspaceInvitesFindCreate(this.storage, inviteId),
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
      workspaceFindAuthorize(this.storage),
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
