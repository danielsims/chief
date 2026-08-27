import type { WorkspaceMember } from "@chief/relay-contracts";
import { isJsonString } from "@chief/relay-contracts";

export type OrganizationRole = "owner" | "admin" | "member";

/** Better Auth supports comma-separated roles when dynamic access control is enabled. */
export function organizationRoles<Input>(value: Input): OrganizationRole[] {
  const values: unknown[] = Array.isArray(value) ? value : [value];
  const roles = values.flatMap((candidate) =>
    isJsonString(candidate) ? candidate.split(",") : [],
  );
  return [...new Set(roles.map((role) => role.trim().toLowerCase()))].filter(
    (role): role is OrganizationRole =>
      role === "owner" || role === "admin" || role === "member",
  );
}

export function primaryOrganizationRole<Input>(
  value: Input,
): OrganizationRole | null {
  const roles = organizationRoles(value);
  if (roles.includes("owner")) return "owner";
  if (roles.includes("admin")) return "admin";
  if (roles.includes("member")) return "member";
  return null;
}

export function canManageChannels(role: OrganizationRole | null): boolean {
  return role === "owner" || role === "admin";
}

export function canDeleteChannels(role: OrganizationRole | null): boolean {
  return role === "owner";
}

export function workspaceRoleForUser(
  members: readonly WorkspaceMember[],
  userId: string | null | undefined,
): OrganizationRole | null {
  if (!userId) return null;
  return (
    members.find(
      (member) => member.kind === "user" && member.principalId === userId,
    )?.role ?? null
  );
}
