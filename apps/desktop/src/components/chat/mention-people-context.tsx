import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import type { MentionAlias } from "./agent-mention-parser";
import { useAuth } from "../../lib/auth/auth-context";
import { useRelaySession } from "../../lib/relay-session";
import { useRuntime } from "../../lib/runtime";

const MentionPeopleContext = createContext<readonly MentionAlias[]>([]);
const MentionAliasesContext = createContext<readonly MentionAlias[]>([]);

export function MentionPeopleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { agents } = useRuntime();
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

  const aliases = useMemo(
    () => [
      ...people,
      ...agents.flatMap((agent) => [
        { id: agent.id, name: agent.name },
        ...(agent.subagents ?? []).map(({ id, name }) => ({ id, name })),
      ]),
    ],
    [people, agents],
  );

  return (
    <MentionPeopleContext.Provider value={people}>
      <MentionAliasesContext.Provider value={aliases}>
        {children}
      </MentionAliasesContext.Provider>
    </MentionPeopleContext.Provider>
  );
}

export function useMentionPeople() {
  return useContext(MentionPeopleContext);
}

export function useMentionAliases() {
  return useContext(MentionAliasesContext);
}
