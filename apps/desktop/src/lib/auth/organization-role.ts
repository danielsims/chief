export type OrganizationRole = "owner" | "admin" | "member";

/** Better Auth supports comma-separated roles when dynamic access control is enabled. */
export function organizationRoles(value: unknown): OrganizationRole[] {
  const values = Array.isArray(value) ? value : [value];
  const roles = values.flatMap((candidate) =>
    typeof candidate === "string" ? candidate.split(",") : [],
  );
  return [...new Set(roles.map((role) => role.trim().toLowerCase()))].filter(
    (role): role is OrganizationRole =>
      role === "owner" || role === "admin" || role === "member",
  );
}

export function primaryOrganizationRole(
  value: unknown,
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
