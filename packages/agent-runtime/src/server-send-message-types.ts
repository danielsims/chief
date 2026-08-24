import type { ChannelEvent } from "./channel-types.js";
import type { IntegrationSetupRegistry } from "./integration-setup-state.js";
import type { SessionManager } from "./manager.js";
import type { AgentSession } from "./session.js";
import type { ClientMessage, McpServerSpec, ServerMessage } from "./types.js";

type Message = Extract<ClientMessage, { type: "sendMessage" }>;

export interface HandleSendMessageOptions {
  authorizeWorkspace: (
    workspaceId: string,
    capability: Message["executorCapability"],
  ) => Promise<void>;
  bindRootSession: (
    workspaceId: string,
    chatId: string,
    session: AgentSession,
  ) => void;
  broadcastChannelEvent: (workspaceId: string, event: ChannelEvent) => void;
  chatDestinations: Map<string, string>;
  ensureChiefSession: (
    workspaceId: string,
    chatId: string,
    capability: Message["executorCapability"],
  ) => Promise<AgentSession>;
  integrationSetups: IntegrationSetupRegistry;
  manager: SessionManager;
  msg: Message;
  pluginMcpServers: (workspaceId: string) => Promise<McpServerSpec[]>;
  send: (message: ServerMessage) => void;
}
