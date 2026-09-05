import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import type { MentionAlias } from "./agent-mention-parser";
import { useAuth } from "../../lib/auth/auth-context";
import { useRelaySession } from "../../lib/relay-session";

const MentionPeopleContext = createContext<readonly MentionAlias[]>([]);

export function MentionPeopleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { client, snapshot } = useRelaySession();
  const [result, setResult] = useState<{
    client: typeof client;
    members: readonly MentionAlias[];
  }>({ client: null, members: [] });
  const workspaceId = snapshot?.id;

  useEffect(() => {
    if (!client || !workspaceId) return;
    let cancelled = false;
    void client
      .listWorkspaceMembers()
      .then((rows) => {
        if (cancelled) return;
        setResult({
          client,
          members: rows.flatMap((member) =>
            member.kind === "user" && member.name?.trim()
              ? [{ id: member.principalId, name: member.name.trim() }]
              : [],
          ),
        });
      })
      .catch(() => {
        if (!cancelled) setResult({ client, members: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [client, workspaceId]);

  const people = useMemo(() => {
    const aliases: MentionAlias[] = [];
    const seen = new Set<string>();
    const add = (alias: MentionAlias) => {
      const key = `${alias.id}:${alias.name.toLocaleLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      aliases.push(alias);
    };
    if (user?.id && user.name.trim()) {
      add({ id: user.id, name: user.name.trim() });
    }
    if (result.client === client)
      for (const member of result.members) add(member);
    return aliases;
  }, [result, client, user]);

  return (
    <MentionPeopleContext.Provider value={people}>
      {children}
    </MentionPeopleContext.Provider>
  );
}

export function useMentionPeople() {
  return useContext(MentionPeopleContext);
}
