import type { ReactNode } from "react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useAuth } from "../../lib/auth/auth-context";
import { useRelaySession } from "../../lib/relay-session";
import type { MentionAlias } from "./agent-mention-parser";

const MentionPeopleContext = createContext<readonly MentionAlias[]>([]);

export function MentionPeopleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { client, snapshot } = useRelaySession();
  const [members, setMembers] = useState<readonly MentionAlias[]>([]);
  const workspaceId = snapshot?.id;

  useEffect(() => {
    if (!client || !workspaceId) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    void client
      .listWorkspaceMembers()
      .then((rows) => {
        if (cancelled) return;
        setMembers(
          rows.flatMap((member) =>
            member.kind === "user" && member.name?.trim()
              ? [{ id: member.principalId, name: member.name.trim() }]
              : [],
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
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
    for (const member of members) add(member);
    return aliases;
  }, [members, user?.id, user?.name]);

  return (
    <MentionPeopleContext.Provider value={people}>
      {children}
    </MentionPeopleContext.Provider>
  );
}

export function useMentionPeople() {
  return useContext(MentionPeopleContext);
}
