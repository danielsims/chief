import { useEffect, useMemo, useState } from "react";

import type {
  SlackChannelSettings,
  SlackChannelState,
} from "@chief/agent-runtime/types";

import { useRuntime, useWorkspaceCapability } from "./runtime";

export function useSlackChannel(workspaceId: string | null) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [state, setState] = useState<SlackChannelState | null>(null);

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
        message.type === "slackChannel" &&
        message.workspaceId === workspaceId
      ) {
        setState(message.state);
      }
    });
    client.send({
      type: "getSlackChannel",
      workspaceId,
      executorCapability: capability,
    });
    return () => {
      unsubscribe();
    };
  }, [capability, client, cloudOrganizationId, status, workspaceId]);

  return useMemo(
    () => ({
      state,
      ready:
        Boolean(capability) &&
        status === "connected" &&
        workspaceId === cloudOrganizationId,
      save: (
        settings: SlackChannelSettings,
        credentials?: { botToken?: string; appToken?: string },
      ) => {
        if (!workspaceId || !capability || status !== "connected") return;
        client.send({
          type: "saveSlackChannel",
          workspaceId,
          settings,
          credentials,
          executorCapability: capability,
        });
      },
    }),
    [capability, client, cloudOrganizationId, state, status, workspaceId],
  );
}
