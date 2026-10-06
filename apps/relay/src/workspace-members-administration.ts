import type { ChiefOrganizationInvitation } from "@chief/auth/d1-organizations";
import type { Principal, WorkspaceId } from "@chief/relay-contracts";
import {
  cancelWorkspaceInvitationResultSchema,
  createWorkspaceInvitationCommandSchema,
  workspaceInvitationListSchema,
  workspaceInvitationSchema,
} from "@chief/relay-contracts";

import { AuthorizationError } from "./auth";
import { HttpError, json, parseJson } from "./http";
import { withTrustedContext } from "./internal-context";
import { removeWorkspaceOrganizationMember } from "./organization-tenancy";
import { sendWorkspaceInvitationEmail } from "./workspace-invitation-email";

/** A workspace owner or admin, or throws a 403. */
function requireWorkspaceAdmin(
  principal: Principal,
): Extract<Principal, { kind: "user" }> {
  if (
    principal.kind !== "user" ||
    (principal.role !== "owner" && principal.role !== "admin")
  ) {
    throw new AuthorizationError(
      "Only workspace owners and admins can manage invitations.",
    );
  }
  return principal;
}

function invitationDto(row: ChiefOrganizationInvitation) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listWorkspaceInvitations(
  env: Env,
  input: { principal: Principal; workspaceId: WorkspaceId },
) {
  const { listChiefOrganizationInvitations } =
    await import("@chief/auth/d1-organizations");
  const invitations = await listChiefOrganizationInvitations(
    env.AUTH_DB,
    input.workspaceId,
  );
  return json(
    workspaceInvitationListSchema.parse({
      invitations: invitations.map(invitationDto),
    }),
  );
}

export async function createWorkspaceInvitation(
  env: Env,
  request: Request,
  input: {
    principal: Principal;
    requestId: string;
    workspaceId: WorkspaceId;
    context?: Pick<ExecutionContext, "waitUntil">;
  },
) {
  const admin = requireWorkspaceAdmin(input.principal);
  const command = createWorkspaceInvitationCommandSchema.parse(
    await parseJson(request),
  );
  const {
    createChiefOrganizationInvitation,
    getChiefOrganizationSummary,
    getChiefUserIdentity,
  } = await import("@chief/auth/d1-organizations");
  const [organization, inviter] = await Promise.all([
    getChiefOrganizationSummary(env.AUTH_DB, input.workspaceId),
    getChiefUserIdentity(env.AUTH_DB, admin.userId),
  ]);
  if (!organization || !inviter) {
    throw new HttpError(
      404,
      "workspace_invitation_unavailable",
      "This workspace is not ready for invitations.",
    );
  }
  const result = await createChiefOrganizationInvitation(env.AUTH_DB, {
    organizationId: input.workspaceId,
    email: command.email,
    role: command.role,
    inviterId: admin.userId,
  });
  if (!result.ok) {
    throw new HttpError(
      409,
      "workspace_member_exists",
      "That email already belongs to a member of this workspace.",
    );
  }
  const delivery = sendWorkspaceInvitationEmail(env, {
    email: result.invitation.email,
    id: result.invitation.id,
    inviter: { email: inviter.email, name: inviter.name },
    organization: { id: organization.id, name: organization.name },
    role: result.invitation.role,
  });
  if (input.context) {
    input.context.waitUntil(
      delivery.catch((error: unknown) => {
        console.error("relay.workspace_invitation.email.failed", {
          invitationId: result.invitation.id,
          organizationId: input.workspaceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }),
    );
  } else {
    await delivery;
  }
  return json(
    workspaceInvitationSchema.parse(invitationDto(result.invitation)),
    { status: 201 },
  );
}

export async function removeWorkspaceMember(
  env: Env,
  input: {
    principal: Principal;
    requestId: string;
    workspaceId: WorkspaceId;
    kind: "user" | "agent" | "service";
    principalId: string;
  },
) {
  const admin = requireWorkspaceAdmin(input.principal);
  const workspace = env.WORKSPACES.get(
    env.WORKSPACES.idFromName(input.workspaceId),
  );
  const target = new URL("https://workspace.internal/member-remove");
  target.searchParams.set("kind", input.kind);
  target.searchParams.set("principalId", input.principalId);
  const response = await workspace.fetch(
    withTrustedContext(
      new Request(target, {
        method: "POST",
        headers: { "x-chief-internal-operation": "members-remove" },
      }),
      {
        principal: admin,
        requestId: input.requestId,
        workspaceId: input.workspaceId,
      },
    ),
  );
  if (response.ok && input.kind === "user") {
    await removeWorkspaceOrganizationMember(env, {
      userId: input.principalId,
      workspaceId: input.workspaceId,
    });
  }
  return response;
}

export async function cancelWorkspaceInvitation(
  env: Env,
  input: {
    principal: Principal;
    workspaceId: WorkspaceId;
    invitationId: string;
  },
) {
  requireWorkspaceAdmin(input.principal);
  const { cancelChiefOrganizationInvitation } =
    await import("@chief/auth/d1-organizations");
  const canceled = await cancelChiefOrganizationInvitation(env.AUTH_DB, {
    organizationId: input.workspaceId,
    invitationId: input.invitationId,
  });
  if (!canceled) {
    throw new HttpError(
      404,
      "workspace_invitation_not_found",
      "This invitation is no longer pending.",
    );
  }
  return json(
    cancelWorkspaceInvitationResultSchema.parse({
      invitationId: input.invitationId,
      canceled: true,
    }),
  );
}
