import type {
  AuthenticatedIdentity,
  WorkspaceId,
} from "@chief/relay-contracts";

import { AuthorizationError } from "./auth";

export function usesOrganizationTenancy(env: Env) {
  return env.ACCOUNT_IDENTITY_MODE === "chief-account";
}

export async function registerWorkspaceOrganization(
  env: Env,
  input: {
    identity: Extract<AuthenticatedIdentity, { kind: "user" }>;
    name: string;
    website: string;
    workspaceId: WorkspaceId;
  },
) {
  if (!usesOrganizationTenancy(env)) return;
  const { ensureChiefOrganization } =
    await import("@chief/auth/d1-organizations");
  await ensureChiefOrganization(env.AUTH_DB, {
    name: input.name,
    ownerUserId: input.identity.userId,
    website: input.website,
    workspaceId: input.workspaceId,
  });
}

export async function registerWorkspaceOrganizationMember(
  env: Env,
  input: {
    identity: Extract<AuthenticatedIdentity, { kind: "user" }>;
    workspaceId: WorkspaceId;
  },
) {
  if (!usesOrganizationTenancy(env)) return;
  const { ensureChiefOrganizationMember } =
    await import("@chief/auth/d1-organizations");
  await ensureChiefOrganizationMember(env.AUTH_DB, {
    organizationId: input.workspaceId,
    userId: input.identity.userId,
  });
}

export async function requireWorkspaceOrganizationMember(
  env: Env,
  identity: AuthenticatedIdentity,
  workspaceId: WorkspaceId,
) {
  if (!usesOrganizationTenancy(env) || identity.kind !== "user") return;
  const { hasChiefOrganizationMembership } =
    await import("@chief/auth/d1-organizations");
  const allowed = await hasChiefOrganizationMembership(env.AUTH_DB, {
    organizationId: workspaceId,
    userId: identity.userId,
  });
  if (!allowed) {
    throw new AuthorizationError(
      "The account is not a member of this workspace organization.",
    );
  }
}

export async function updateWorkspaceOrganizationMemberRole(
  env: Env,
  input: {
    role: "owner" | "admin" | "member";
    userId: string;
    workspaceId: WorkspaceId;
  },
) {
  if (!usesOrganizationTenancy(env)) return;
  const { updateChiefOrganizationMemberRole } =
    await import("@chief/auth/d1-organizations");
  await updateChiefOrganizationMemberRole(env.AUTH_DB, {
    organizationId: input.workspaceId,
    role: input.role,
    userId: input.userId,
  });
}

export async function removeWorkspaceOrganization(
  env: Env,
  workspaceId: WorkspaceId,
) {
  if (!usesOrganizationTenancy(env)) return;
  const { deleteChiefOrganization } =
    await import("@chief/auth/d1-organizations");
  await deleteChiefOrganization(env.AUTH_DB, workspaceId);
}
