import { useEffect, useState } from "react";

import type { OrganizationRole } from "./auth/organization-role";
import { useAuth } from "./auth/auth-context";
import { workspaceRoleForUser } from "./auth/organization-role";
import { useRelaySession } from "./relay-session-context";

// Roles read this session, by workspace and person, so a screen that opens
// later draws its controls at once rather than popping them in.
const roles = new Map<string, OrganizationRole | null>();
const reads = new Map<string, Promise<OrganizationRole | null>>();

/**
 * The signed-in person's role in the active workspace, as the relay records
 * it, and whether it has been read yet. Read once per workspace and person;
 * every screen asking at once shares the one request.
 */
export function useWorkspaceRoleState(): {
  role: OrganizationRole | null;
  loaded: boolean;
} {
  const { client, snapshot } = useRelaySession();
  const { user } = useAuth();
  const workspaceId = snapshot?.id ?? null;
  const userId = user?.id ?? null;
  const key = `${workspaceId ?? ""}:${userId ?? ""}`;
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!client || !workspaceId || !userId || roles.has(key)) return;
    let cancelled = false;
    const read =
      reads.get(key) ??
      client
        .listWorkspaceMembers()
        .then((members) => {
          const role = workspaceRoleForUser(members, userId);
          roles.set(key, role);
          return role;
        })
        .finally(() => reads.delete(key));
    reads.set(key, read);
    void read
      .then(() => {
        if (!cancelled) setVersion((version) => version + 1);
      })
      .catch((error: unknown) => {
        console.warn("[Workspace] Could not read your role:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [client, key, userId, workspaceId]);

  return { role: roles.get(key) ?? null, loaded: roles.has(key) };
}

/**
 * The role alone. The relay is what enforces owner and admin actions, so it
 * decides which controls to show; null until it answers.
 */
export function useWorkspaceRole(): OrganizationRole | null {
  return useWorkspaceRoleState().role;
}
