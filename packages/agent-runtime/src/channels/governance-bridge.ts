import type { SessionManager } from "../manager.js";
import type { ClientMessage, ServerMessage } from "../types.js";
import { authorizeOrganizationRole } from "../organization-authorization.js";

type GovernanceMessage = Extract<
  ClientMessage,
  { type: "setChannelPolicy" | "setChannelArchived" }
>;

interface VerifiedCapability {
  apiBaseUrl: string;
}

export async function handleGovernanceRequest(
  message: ClientMessage,
  input: {
    manager: SessionManager;
    send: (message: ServerMessage) => void;
    capability: (token: string) => VerifiedCapability | undefined;
    broadcastChannels: (workspaceId: string) => void | Promise<void>;
  },
) {
  if (
    message.type !== "setChannelPolicy" &&
    message.type !== "setChannelArchived"
  ) {
    return false;
  }
  const verified = input.capability(message.executorCapability.token);
  try {
    if (!verified) {
      throw new Error("Could not verify access to this workspace.");
    }
    await authorizeManagement(message, verified);
    const channel = await updateChannel(input.manager, message);
    input.send(
      message.type === "setChannelPolicy"
        ? {
            type: "channelPolicyUpdated",
            requestId: message.requestId,
            workspaceId: message.workspaceId,
            channel,
          }
        : {
            type: "channelUpdated",
            requestId: message.requestId,
            workspaceId: message.workspaceId,
            channel,
          },
    );
    await input.broadcastChannels(message.workspaceId);
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Chief could not update this channel.";
    input.send(
      message.type === "setChannelPolicy"
        ? {
            type: "channelPolicyUpdateFailed",
            requestId: message.requestId,
            workspaceId: message.workspaceId,
            channelId: message.channelId,
            message: detail,
          }
        : {
            type: "channelUpdateFailed",
            requestId: message.requestId,
            workspaceId: message.workspaceId,
            channelId: message.channelId,
            message: detail,
          },
    );
  }
  return true;
}

function authorizeManagement(
  message: GovernanceMessage,
  capability: VerifiedCapability,
) {
  const policy = message.type === "setChannelPolicy";
  return authorizeOrganizationRole({
    apiBaseUrl: capability.apiBaseUrl,
    allowedRoles: policy ? ["owner"] : ["owner", "admin"],
    errorMessage: policy
      ? "Only workspace owners can change agent channel access."
      : "Only workspace owners and admins can archive channels.",
    sessionToken: message.sessionToken,
    workspaceId: message.workspaceId,
  });
}

function updateChannel(manager: SessionManager, message: GovernanceMessage) {
  const store = manager.store.channelStore();
  if (message.type === "setChannelPolicy") {
    return store.setPolicy(
      message.workspaceId,
      message.channelId,
      message.agentPermissions,
      { type: "user", id: "workspace-owner", name: "Workspace owner" },
    );
  }
  return store.setArchived(
    message.workspaceId,
    message.channelId,
    message.archived,
    {
      actor: {
        type: "user",
        id: "workspace-owner",
        name: "Workspace owner",
      },
    },
  );
}
