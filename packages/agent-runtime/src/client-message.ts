import type { MessageComponent } from "@chief/relay-contracts";

import type * as Artifacts from "./artifact-types.js";
import type { ChannelClientMessage } from "./channel-types.js";
import type { ProjectClientMessage } from "./projects/client-message.js";
import type {
  AccessMode,
  AgentPreference,
  BrowserRunConversationMessage,
  CampaignRecord,
  ChatExecutionSelection,
  DriverType,
  EveAgentProvisioningInput,
  ExecutorCapability,
  InputRequest,
  MessageAttachment,
  OnboardingSchedule,
  OnboardingWorkJob,
  RecurringWorkRecord,
  SlackChannelSettings,
  WorkspaceFileWrite,
  WorkspaceOperatingMode,
} from "./types.js";

export type ClientMessage =
  | { type: "listAgents" }
  | ProjectClientMessage
  | ChannelClientMessage
  | Artifacts.ListArtifactsMessage
  | {
      type: "listBrowserRuns";
      workspaceId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "anchorBrowserRun";
      workspaceId: string;
      browserRunId: string;
      messageId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "listChats";
      workspaceId: string;
      executorCapability: ExecutorCapability;
    }
  | { type: "listModels"; driver: DriverType }
  | {
      type: "listWorkspaceData";
      workspaceId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "saveWorkspaceWaysOfWorking";
      workspaceId: string;
      requestId: string;
      mode: WorkspaceOperatingMode;
      missionControlChannelId: string;
      sessionToken: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "runMissionControlHeartbeatNow";
      workspaceId: string;
      requestId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "listDiagnostics";
      workspaceId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "listWorkspaceFiles";
      requestId?: string;
      workspaceId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "getWorkspaceFile";
      workspaceId: string;
      fileId: string;
      requestId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "saveWorkspaceFile";
      workspaceId: string;
      file: WorkspaceFileWrite;
      requestId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "deleteWorkspaceFile";
      workspaceId: string;
      fileId: string;
      requestId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "renderWorkspaceEmail";
      workspaceId: string;
      fileId: string;
      requestId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "bootstrapOnboardingWork";
      workspaceId: string;
      requestId: string;
      jobs: OnboardingWorkJob[];
      schedules: OnboardingSchedule[];
      workspaceContext?: string;
      /** Agent app explicitly chosen during onboarding. */
      driver?: DriverType;
      /** Null explicitly selects the agent app's automatic model. */
      model?: string | null;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "listAgentPreferences";
      workspaceId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "saveCampaign";
      workspaceId: string;
      campaign: CampaignRecord;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "saveRecurringWork";
      workspaceId: string;
      requestId?: string;
      work: RecurringWorkRecord;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "rotateRecurringWorkWebhook";
      workspaceId: string;
      requestId: string;
      recurringWorkId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "runRecurringWorkNow";
      workspaceId: string;
      recurringWorkId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "dismissActionItem";
      workspaceId: string;
      actionItemId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "resolveActionRequest";
      workspaceId: string;
      actionItemId: string;
      requestId: string;
      answers: Record<string, string>;
      values: Record<string, string>;
      resolvedBy: { id: string; name: string };
      setup?: { chatId: string; domain: string };
      executorCapability: ExecutorCapability;
    }
  /** The user explicitly allows the exact tools a session was blocked on. */
  | {
      type: "expandRecurringWorkGrant";
      workspaceId: string;
      recurringWorkId: string;
      addTools: string[];
      rerun?: boolean;
      executorCapability: ExecutorCapability;
    }
  /** Rejecting a proposal removes the schedule and its session history. */
  | {
      type: "deleteRecurringWork";
      workspaceId: string;
      recurringWorkId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "saveAgentPreference";
      requestId: string;
      workspaceId: string;
      preference: AgentPreference;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "openChat";
      /** Brand/setup context markdown composed into the system prompt. */
      workspaceContext?: string;
      chatId: string;
      workspaceId: string;
      execution?: ChatExecutionSelection;
      access?: AccessMode;
      purpose?: "integration-setup" | "analytics-report";
      integrationDomain?: string;
      /** Explicit conversation destination for chats whose ID has another purpose. */
      channelId?: string;
      /** Agent identity used for a direct conversation. */
      agentId?: string;
      /** UI publication boundary; relay-backed DMs remain direct. */
      conversationSurface?: "direct" | "channel";
      executorCapability: ExecutorCapability;
    }
  | {
      type: "observeChat";
      chatId: string;
      workspaceId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "sendMessage";
      workspaceId: string;
      chatId: string;
      messageId: string;
      text: string;
      attachments?: MessageAttachment[];
      threadRootId?: string;
      mentions?: string[];
      components?: MessageComponent[];
      senderName?: string;
      /** A user follow-up should replace the active turn instead of waiting
       * behind it. The runtime also detects a busy session defensively. */
      interruptActive?: boolean;
      execution?: ChatExecutionSelection;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "closeChat";
      workspaceId: string;
      chatId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "deleteChat";
      chatId: string;
      workspaceId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "interruptChat";
      workspaceId: string;
      chatId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "respondPermission";
      workspaceId: string;
      chatId: string;
      requestId: string;
      behavior: "allow" | "deny";
      executorCapability: ExecutorCapability;
    }
  /** Answers for an agent question, keyed by question text; null dismisses. */
  | {
      type: "respondQuestion";
      workspaceId: string;
      chatId: string;
      requestId: string;
      answers: Record<string, string> | null;
      executorCapability: ExecutorCapability;
    }
  /** User submitted values for an agent's input request; the runtime stores
   * them per each field's `save` target and tells the agent where. */
  | {
      type: "provideInput";
      chatId: string;
      request: InputRequest;
      values: Record<string, string>;
      workspaceId: string;
      executorCapability: ExecutorCapability;
      recurringWorkId?: string;
    }
  /** Which of these secret env keys already exist for this workspace?
   * Answered with inputsStatus. Lets the app collect required credentials
   * BEFORE any agent session starts. */
  | {
      type: "queryInputs";
      workspaceId: string;
      keys: string[];
      executorCapability: ExecutorCapability;
    }
  /** Store values with no agent session involved (pre-connect requirement
   * forms). Runtime stores them and broadcasts a fresh inputsStatus. */
  | {
      type: "storeInput";
      workspaceId: string;
      request: InputRequest;
      values: Record<string, string>;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "listVercelEveDestinations";
      workspaceId: string;
      requestId: string;
      teamId?: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "provisionVercelEveAgent";
      workspaceId: string;
      requestId: string;
      input: EveAgentProvisioningInput;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "listWorkspaceEnvironmentVariables";
      workspaceId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "saveWorkspaceEnvironmentVariable";
      workspaceId: string;
      key: string;
      value: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "deleteWorkspaceEnvironmentVariable";
      workspaceId: string;
      key: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "inspectWorkspaceIntegrations";
      workspaceId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "listPlugins";
      workspaceId: string;
      requestId?: string;
      refresh?: boolean;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "installPlugin";
      workspaceId: string;
      pluginId: string;
      trusted: boolean;
      requestId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "authorizePlugin";
      workspaceId: string;
      pluginId: string;
      requestId: string;
      oauthClient?: {
        serverName: string;
        clientId: string;
        clientSecret?: string;
      };
      executorCapability: ExecutorCapability;
    }
  | {
      type: "uninstallPlugin";
      workspaceId: string;
      pluginId: string;
      requestId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "disconnectGoogleAnalytics";
      workspaceId: string;
      requestId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "getSlackChannel";
      workspaceId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "saveSlackChannel";
      workspaceId: string;
      settings: SlackChannelSettings;
      credentials?: { botToken?: string; appToken?: string };
      executorCapability: ExecutorCapability;
    }
  | {
      type: "browserNavigateRequest";
      workspaceId: string;
      conversationId: string;
      browserRunId?: string;
      threadRootId?: string;
      url: string;
      width: number;
      height: number;
    }
  | BrowserRunConversationMessage<"browserReload">
  | BrowserRunConversationMessage<"browserClose">
  | {
      type: "browserUrlChanged";
      workspaceId: string;
      conversationId: string;
      browserRunId: string;
      url: string;
    }
  | {
      type: "browserViewportResize";
      workspaceId: string;
      conversationId: string;
      browserRunId: string;
      width: number;
      height: number;
    };
