import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import type {
  ChannelGuestSummary,
  WorkspaceMember,
} from "@chief/relay-contracts";

import type { MentionAlias } from "./agent-mention-parser";
import { useAuth } from "../../lib/auth/auth-context";
import { guestSummaryAppearance } from "../../lib/guest-appearance";
import { relayAvatarUrl } from "../../lib/relay-avatar";
import { useRelaySession } from "../../lib/relay-session";
import { useRuntime } from "../../lib/runtime";

const MentionPeopleContext = createContext<readonly MentionAlias[]>([]);
const MentionAliasesContext = createContext<readonly MentionAlias[]>([]);
const WorkspaceUsersContext = createContext<ReadonlyMap<string, WorkspaceUser>>(
  new Map(),
);

/** A human workspace member, as messages and profiles present them. */
export interface WorkspaceUser {
  id: string;
  name: string;
  email?: string;
  image?: string;
  role: WorkspaceMember["role"];
}

export function MentionPeopleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { agents } = useRuntime();
  const { client, snapshot } = useRelaySession();
  const [result, setResult] = useState<{
    client: typeof client;
    members: readonly WorkspaceUser[];
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
              ? [
                  {
                    id: member.principalId,
                    name: member.name.trim(),
                    role: member.role,
                    ...(member.email ? { email: member.email } : undefined),
                    ...(relayAvatarUrl(member.image)
                      ? { image: relayAvatarUrl(member.image) }
                      : undefined),
                  },
                ]
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
      for (const member of result.members)
        add({ id: member.id, name: member.name });
    return aliases;
  }, [result, client, user]);

  const users = useMemo(
    () =>
      new Map(
        (result.client === client ? result.members : []).map((member) => [
          member.id,
          member,
        ]),
      ),
    [result, client],
  );

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
    <WorkspaceUsersContext.Provider value={users}>
      <MentionPeopleContext.Provider value={people}>
        <MentionAliasesContext.Provider value={aliases}>
          {children}
        </MentionAliasesContext.Provider>
      </MentionPeopleContext.Provider>
    </WorkspaceUsersContext.Provider>
  );
}

/**
 * Adds a channel's outside guest agents to the mentions everything below can
 * parse, so `@opencode` or `@danielsims:grokbot` render as chips. Guests are
 * per channel, so this wraps one channel's chat rather than the app.
 */
export function ChannelGuestMentions({
  children,
  guests,
}: {
  children: ReactNode;
  guests: readonly ChannelGuestSummary[];
}) {
  const parent = useContext(MentionAliasesContext);
  const aliases = useMemo(
    () => [
      ...parent,
      ...guests.flatMap((guest) => {
        const appearance = guestSummaryAppearance(guest);
        const id = `guest:${guest.id}`;
        return [
          { id, name: guest.handle, label: guest.name, guest: appearance },
          { id, name: guest.name, label: guest.name, guest: appearance },
        ];
      }),
    ],
    [guests, parent],
  );
  return (
    <MentionAliasesContext.Provider value={aliases}>
      {children}
    </MentionAliasesContext.Provider>
  );
}

export function useMentionPeople() {
  return useContext(MentionPeopleContext);
}

export function useMentionAliases() {
  return useContext(MentionAliasesContext);
}

/** Human workspace members by user id. */
export function useWorkspaceUsers() {
  return useContext(WorkspaceUsersContext);
}
