import type {
  AgentPreference,
  ClientMessage,
  ServerMessage,
} from "@chief/agent-runtime/types";
import type { CreateNativeAgentCommand } from "@chief/relay-contracts";

/**
 * Commands the desktop sends to its workspace. Local-runtime commands that no
 * cloud workspace serves are excluded, so sending one cannot compile.
 */
export type RuntimeCommand = Exclude<
  ClientMessage,
  {
    type:
      | "bootstrapOnboardingWork"
      | "createProjectPullRequest"
      | "deleteChat"
      | "deleteWorkspaceFile"
      | "discardProjectCheckout"
      | "disconnectGoogleAnalytics"
      | "dismissActionItem"
      | "expandRecurringWorkGrant"
      | "getSlackChannel"
      | "inspectWorkspaceIntegrations"
      | "listArtifacts"
      | "listDiagnostics"
      | "listProjectAccessRequests"
      | "listVercelEveDestinations"
      | "provideInput"
      | "provisionVercelEveAgent"
      | "publishProjectCheckout"
      | "queryInputs"
      | "renderWorkspaceEmail"
      | "resolveActionRequest"
      | "resolveProjectAccessRequest"
      | "respondPermission"
      | "respondQuestion"
      | "rotateRecurringWorkWebhook"
      | "runMissionControlHeartbeatNow"
      | "saveCampaign"
      | "saveSlackChannel"
      | "saveWorkspaceWaysOfWorking"
      | "setChannelPolicy"
      | "storeInput";
  }
>;

export type RuntimeMessageListener = (message: ServerMessage) => void;
export type RuntimeConnectionStatus =
  "connecting" | "connected" | "disconnected";

/** UI-facing relay boundary that keeps transport and authentication out of views. */
export interface RuntimeTransport {
  setStatusListener(listener: (status: RuntimeConnectionStatus) => void): void;
  connect(): void;
  reconnectNow(): void;
  startDirectMessage(agentId: string): Promise<string>;
  removeAgent(agentId: string): Promise<void>;
  createNativeAgent(
    input: CreateNativeAgentCommand,
    preference?: AgentPreference,
  ): Promise<void>;
  send(message: RuntimeCommand): void;
  subscribe(listener: RuntimeMessageListener): () => void;
  destroy(): void;
}
