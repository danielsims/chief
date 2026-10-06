import { useEffect, useState } from "react";

import type { OrganizationRole } from "./auth/organization-role";
import { useAuth } from "./auth/auth-context";
import { workspaceRoleForUser } from "./auth/organization-role";
import { useRelaySession } from "./relay-session-context";

/**
 * The signed-in person's role in the active workspace, as the relay records
 * it. The relay is what enforces owner and admin actions, so it decides which
 * controls to show; null until it answers.
 */
export function useWorkspaceRole(): OrganizationRole | null {
  const { client, snapshot } = useRelaySession();
  const { user } = useAuth();
  const workspaceId = snapshot?.id ?? null;
  const userId = user?.id ?? null;
  const [loaded, setLoaded] = useState<{
    key: string;
    role: OrganizationRole | null;
  } | null>(null);
  const key = `${workspaceId ?? ""}:${userId ?? ""}`;

  useEffect(() => {
    if (!client || !workspaceId || !userId) return;
    let cancelled = false;
    void client
      .listWorkspaceMembers()
      .then((members) => {
        if (cancelled) return;
        setLoaded({ key, role: workspaceRoleForUser(members, userId) });
      })
      .catch((error: unknown) => {
        console.warn("[Workspace] Could not read your role:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [client, key, userId, workspaceId]);

  return loaded?.key === key ? loaded.role : null;
}
