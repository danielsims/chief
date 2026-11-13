import { useCallback, useEffect, useState } from "react";

import type { AgentPresence } from "../components/chat/agent-profile-panel";
import { useRuntime } from "./runtime-provider";
import { useWorkspaceCapability } from "./workspace-capability";

interface Presence {
  workspaceId: string;
  userIds: ReadonlySet<string>;
  offlineAgentIds: ReadonlySet<string>;
  erroredAgentIds: ReadonlySet<string>;
}

/**
 * Who is connected, from the workspace socket. A subagent runs in its parent's
 * cell on the same agent app, so it is offline with its parent and red when
 * its parent's last run failed: a parent that can't run means neither can it.
 */
export function useWorkspacePresence() {
  const { client, status, agents } = useRuntime();
  const { cloudOrganizationId } = useWorkspaceCapability();
  const [presence, setPresence] = useState<Presence | null>(null);

  useEffect(() => {
    if (!cloudOrganizationId || status !== "connected") return;
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type !== "presence" ||
        message.workspaceId !== cloudOrganizationId
      )
        return;
      setPresence({
        workspaceId: message.workspaceId,
        userIds: new Set(message.userIds),
        offlineAgentIds: new Set(message.offlineAgentIds),
        erroredAgentIds: new Set(message.erroredAgentIds),
      });
    });
    client.send({ type: "getPresence", workspaceId: cloudOrganizationId });
    return unsubscribe;
  }, [client, cloudOrganizationId, status]);

  const current =
    status === "connected" && presence?.workspaceId === cloudOrganizationId
      ? presence
      : null;

  const agentPresence = useCallback(
    (agentId: string, working = false): AgentPresence => {
      if (working) return "working";
      if (status !== "connected") return "offline";
      const host = hostAgentId(agents, agentId);
      if (
        current?.erroredAgentIds.has(agentId) ||
        current?.erroredAgentIds.has(host)
      )
        return "error";
      return current?.offlineAgentIds.has(host)
        ? "offline"
        : "online";
    },
    [agents, current, status],
  );
  const userOnline = useCallback(
    (userId: string | undefined) =>
      userId !== undefined && current?.userIds.has(userId) === true,
    [current],
  );

  return { agentPresence, userOnline };
}

/** The agent whose cell runs this one: itself, or its parent for a subagent. */
function hostAgentId(
  agents: readonly { id: string; subagents?: readonly { id: string }[] }[],
  agentId: string,
) {
  return (
    agents.find((agent) =>
      agent.subagents?.some((child) => child.id === agentId),
    )?.id ?? agentId
  );
}
