export type WorkspaceRole = "owner" | "admin" | "member";

function workspaceRoles(value: unknown): WorkspaceRole[] {
  const values = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      values.flatMap((candidate) =>
        typeof candidate === "string"
          ? candidate
              .split(",")
              .map((role) => role.trim().toLowerCase())
              .filter(
                (role): role is WorkspaceRole =>
                  role === "owner" || role === "admin" || role === "member",
              )
          : [],
      ),
    ),
  ];
}

export async function authorizeOrganizationRole(input: {
  apiBaseUrl: string;
  allowedRoles: readonly WorkspaceRole[];
  errorMessage: string;
  fetcher?: typeof fetch;
  sessionToken: string;
  workspaceId: string;
}): Promise<WorkspaceRole> {
  if (!input.sessionToken.trim()) throw new Error(input.errorMessage);
  const url = new URL(
    "/api/auth/organization/get-active-member",
    new URL(input.apiBaseUrl).origin,
  );
  const response = await (input.fetcher ?? fetch)(url, {
    headers: { Authorization: `Bearer ${input.sessionToken}` },
  });
  const member = (await response.json().catch(() => null)) as {
    organizationId?: unknown;
    role?: unknown;
  } | null;
  if (!response.ok || member?.organizationId !== input.workspaceId) {
    throw new Error(input.errorMessage);
  }
  const role = workspaceRoles(member.role).find((candidate) =>
    input.allowedRoles.includes(candidate),
  );
  if (!role) throw new Error(input.errorMessage);
  return role;
}
