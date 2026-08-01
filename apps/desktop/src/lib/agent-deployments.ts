import { useEffect, useMemo, useState } from "react";

import type {
  AgentDeploymentChannel,
  AgentDeploymentPlaybook,
  AgentDeploymentRecord,
  AgentDeploymentTarget,
} from "@chief/agent-runtime/types";

import { useRuntime, useWorkspaceCapability } from "./runtime";

export function useAgentDeployments(workspaceId: string | null) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [deploymentState, setDeploymentState] = useState<{
    workspaceId: string | null;
    deployments: AgentDeploymentRecord[];
  }>({ workspaceId, deployments: [] });
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
        setDeploymentState({ workspaceId, deployments: message.deployments });
      }
      if (
        message.type === "agentDeploymentUpdated" &&
        message.workspaceId === workspaceId
      ) {
        setDeploymentState((current) => ({
          workspaceId,
          deployments: [
            message.deployment,
            ...(current.workspaceId === workspaceId
              ? current.deployments.filter(
                  (item) => item.id !== message.deployment.id,
                )
              : []),
          ],
        }));
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
      deployments:
        deploymentState.workspaceId === workspaceId
          ? deploymentState.deployments
          : [],
      ready:
        Boolean(capability) &&
        status === "connected" &&
        workspaceId === cloudOrganizationId,
      start: (input: {
        agentId: string;
        target: AgentDeploymentTarget;
        projectName: string;
        teamId?: string;
        model?: string;
        playbooks: AgentDeploymentPlaybook[];
        channels?: AgentDeploymentChannel[];
        activate?: boolean;
      }) => {
        if (!workspaceId || !capability || status !== "connected") return false;
        client.send({
          type: "startAgentDeployment",
          workspaceId,
          ...input,
          executorCapability: capability,
        });
        return true;
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
    [
      capability,
      client,
      cloudOrganizationId,
      deploymentState,
      status,
      workspaceId,
    ],
  );
}
