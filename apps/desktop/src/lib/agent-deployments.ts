import { useEffect, useMemo, useState } from "react";

import type {
  AgentDeploymentPlaybook,
  AgentDeploymentRecord,
} from "@chief/agent-runtime/types";

import { useRuntime, useWorkspaceCapability } from "./runtime";

export function useAgentDeployments(workspaceId: string | null) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [deployments, setDeployments] = useState<AgentDeploymentRecord[]>([]);

  useEffect(() => {
    if (
      !workspaceId ||
      workspaceId !== cloudOrganizationId ||
      !capability ||
      status !== "connected"
    ) {
      return;
    }
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type === "agentDeployments" &&
        message.workspaceId === workspaceId
      ) {
        setDeployments(message.deployments);
      }
      if (
        message.type === "agentDeploymentUpdated" &&
        message.workspaceId === workspaceId
      ) {
        setDeployments((current) => [
          message.deployment,
          ...current.filter((item) => item.id !== message.deployment.id),
        ]);
      }
    });
    client.send({
      type: "listAgentDeployments",
      workspaceId,
      executorCapability: capability,
    });
    return () => {
      unsubscribe();
    };
  }, [capability, client, cloudOrganizationId, status, workspaceId]);

  return useMemo(
    () => ({
      deployments,
      ready:
        Boolean(capability) &&
        status === "connected" &&
        workspaceId === cloudOrganizationId,
      start: (input: {
        agentId: string;
        projectName: string;
        teamId?: string;
        playbooks: AgentDeploymentPlaybook[];
      }) => {
        if (!workspaceId || !capability) return;
        client.send({
          type: "startAgentDeployment",
          workspaceId,
          ...input,
          executorCapability: capability,
        });
      },
      cancel: (deploymentId: string) => {
        if (!workspaceId || !capability) return;
        client.send({
          type: "cancelAgentDeployment",
          workspaceId,
          deploymentId,
          executorCapability: capability,
        });
      },
    }),
    [capability, client, cloudOrganizationId, deployments, status, workspaceId],
  );
}
