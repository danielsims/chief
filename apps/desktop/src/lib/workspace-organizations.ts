import type { AuthOrganization } from "./auth/better-auth-client";

/** Keep the current workspace first while preserving the server order. */
export function activeFirstOrganizations(
  organizations: readonly AuthOrganization[],
  activeOrganizationId: string | null,
) {
  if (!activeOrganizationId) return [...organizations];
  const active = organizations.find(
    (organization) => organization.id === activeOrganizationId,
  );
  if (!active) return [...organizations];
  return [
    active,
    ...organizations.filter(
      (organization) => organization.id !== activeOrganizationId,
    ),
  ];
}
