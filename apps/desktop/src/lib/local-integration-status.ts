import { useEffect, useState } from "react";

import type { LocalIntegrationStatus } from "@chief/agent-runtime/types";

import {
  cachedLocalIntegrationStatus,
  primeLocalIntegrationStatus,
} from "./local-integration-status-cache";
import { useRuntime, useWorkspaceCapability } from "./runtime";

export function useLocalIntegrationStatus() {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [state, setState] = useState<{
    workspaceId: string;
    integrations: LocalIntegrationStatus[];
  } | null>(() => {
    if (!cloudOrganizationId) return null;
    const integrations = cachedLocalIntegrationStatus(cloudOrganizationId);
    return integrations
      ? { workspaceId: cloudOrganizationId, integrations }
      : null;
  });
  const integrations =
    state?.workspaceId === cloudOrganizationId
      ? state.integrations
      : cloudOrganizationId
        ? cachedLocalIntegrationStatus(cloudOrganizationId)
        : null;

  useEffect(() => {
    if (status !== "connected" || !cloudOrganizationId || !capability) return;

    const inspect = () =>
      client.send({
        type: "inspectWorkspaceIntegrations",
        workspaceId: cloudOrganizationId,
        executorCapability: capability,
      });
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type === "localIntegrationStatus" &&
        message.workspaceId === cloudOrganizationId
      ) {
        primeLocalIntegrationStatus(message.workspaceId, message.integrations);
        setState({
          workspaceId: message.workspaceId,
          integrations: message.integrations,
        });
      } else if (
        message.type === "integrationVerified" &&
        message.workspaceId === cloudOrganizationId
      ) {
        inspect();
      }
    });
    inspect();
    return () => {
      unsubscribe();
    };
  }, [capability, client, cloudOrganizationId, status]);

  const refresh = () => {
    if (!cloudOrganizationId || !capability) return;
    client.send({
      type: "inspectWorkspaceIntegrations",
      workspaceId: cloudOrganizationId,
      executorCapability: capability,
    });
  };

  return { integrations, refresh };
}
