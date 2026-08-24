import { z } from "zod";

export type WorkspaceRole = "owner" | "admin" | "member";

const workspaceRoleSchema = z.enum(["owner", "admin", "member"]);
const workspaceRoleInputSchema = z.union([z.string(), z.array(z.string())]);

function workspaceRoles(value: unknown): WorkspaceRole[] {
  const parsed = workspaceRoleInputSchema.safeParse(value);
  if (!parsed.success) return [];
  const values = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  return [
    ...new Set(
      values.flatMap((candidate) =>
        candidate
          .split(",")
          .map((role) =>
            workspaceRoleSchema.safeParse(role.trim().toLowerCase()),
          )
          .flatMap((role) => (role.success ? [role.data] : [])),
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
