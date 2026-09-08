import type {
  AgentPluginSummary,
  PluginAuthorizationAction,
} from "@chief/plugin-api";

import type {
  AgentEvent,
  AnalyticsDataset,
  ChiefUIMessage,
  WorkspaceFileRecord,
  WorkspaceFileSnapshot,
} from "./agent-message-types.js";
import type * as Artifacts from "./artifact-types.js";
import type { ChannelServerMessage } from "./channel-types.js";
import type { IntegrationSetupPhase } from "./integration-setup-recipes.js";
import type {
  ProjectAccessRequestRecord,
  ProjectBranchComparison,
  ProjectCommitDetail,
  ProjectRecord,
  ProjectRepositoryBrowserSnapshot,
  ProjectRepositorySnapshot,
  ProviderPullRequest,
} from "./project-types.js";
import type {
  ActionItem,
  AgentDefinition,
  AgentPreference,
  CampaignRecord,
  ChatExecutionSelection,
  ContentDraftRecord,
  DiagnosticEventRecord,
  DriverType,
  EveAgentProvisioningProgress,
  EveAgentProvisioningResult,
  LocalIntegrationStatus,
  ProspectRecord,
  ProviderModelOption,
  RecurringWorkRecord,
  SessionRecord,
  SlackChannelState,
  TrendRecord,
  VercelEveDestinationCatalog,
  WorkspaceEnvironmentVariable,
  WorkspaceWaysOfWorking,
} from "./runtime-domain-types.js";

export type {
  AgentPluginSummary,
  PluginAuthorizationAction,
} from "@chief/plugin-api";

export type {
  ChannelActor,
  ChannelEvent,
  WorkspaceChannel,
} from "./channel-types.js";
export type {
  BrowserAutomationCommand,
  BrowserAutomationResult,
  BrowserPageSnapshot,
} from "./browser-types.js";
export type * from "./project-types.js";

export type * from "./agent-message-types.js";

export * from "./runtime-domain-types.js";

// ---- WebSocket protocol between clients (desktop app, future Slack bridge) and the service ----

interface BrowserConversationMessage<T extends string> {
  type: T;
  workspaceId: string;
  conversationId: string;
}

export interface BrowserRunConversationMessage<
  T extends string,
> extends BrowserConversationMessage<T> {
  browserRunId: string;
}

export interface BrowserRunRecord {
  id: string;
  workspaceId: string;
  conversationId: string;
  parentConversationId?: string;
  threadRootId?: string;
  anchorMessageId?: string;
  url: string;
  title?: string;
  status: "active" | "complete";
  createdAt: number;
  updatedAt: number;
}

export type BrowserPresentationMode = "inline" | "picture-in-picture";

export type { ClientMessage } from "./client-message.js";

/** A short-lived event the app surfaces as a toast or OS notification. */
export interface RuntimeNotice {
  kind:
    | "work-started"
    | "work-completed"
    | "setup-required"
    | "work-blocked"
    | "work-failed"
    | "action";
  title: string;
  detail?: string;
  /** Optional deep-link target for the surfaced notice. */
  sourceId?: string;
  agentId?: string;
  sessionId?: string;
  recurringWorkId?: string;
}

export interface IntegrationSetupProgress {
  recipeId: string;
  phase: IntegrationSetupPhase;
  instruction: string;
  service?: string;
  status: "active" | "complete" | "error";
}
export type ServerMessage =
  | { type: "agents"; agents: AgentDefinition[] }
  | {
      type: "projects";
      workspaceId: string;
      projects: ProjectRepositorySnapshot[];
    }
  | {
      type: "projectSaved";
      workspaceId: string;
      requestId: string;
      project: ProjectRecord;
    }
  | {
      type: "projectBrowser";
      workspaceId: string;
      requestId: string;
      browser: ProjectRepositoryBrowserSnapshot;
    }
  | {
      type: "projectCommit";
      workspaceId: string;
      requestId: string;
      detail: ProjectCommitDetail;
    }
  | {
      type: "projectComparison";
      workspaceId: string;
      requestId: string;
      comparison: ProjectBranchComparison;
    }
  | {
      type: "projectPublished";
      workspaceId: string;
      requestId: string;
      checkoutId: string;
      branch: string;
      head: string;
    }
  | {
      type: "projectCheckoutDiscarded";
      workspaceId: string;
      requestId: string;
      checkoutId: string;
    }
  | {
      type: "projectPullRequestCreated";
      workspaceId: string;
      requestId: string;
      pullRequest: ProviderPullRequest;
    }
  | {
      type: "projectAccessRequests";
      workspaceId: string;
      requests: ProjectAccessRequestRecord[];
    }
  | {
      type: "projectAccessRequestResolved";
      workspaceId: string;
      requestId: string;
    }
  | ChannelServerMessage
  | { type: "models"; driver: DriverType; models: ProviderModelOption[] }
  | Artifacts.ArtifactsMessage
  | {
      type: "browserNavigate";
      browserRunId: string;
      workspaceId: string;
      conversationId: string;
      parentConversationId?: string;
      threadRootId?: string;
      anchorMessageId?: string;
      url: string;
      streamUrl: string;
    }
  | {
      type: "browserPrepare";
      browserRunId: string;
      workspaceId: string;
      conversationId: string;
      parentConversationId?: string;
      threadRootId?: string;
      anchorMessageId?: string;
      url: string;
    }
  | {
      type: "browserActivity";
      browserRunId: string;
      workspaceId: string;
      conversationId: string;
      phase: "started" | "completed";
      label: string;
      cursor?: {
        x: number;
        y: number;
        pressed?: boolean;
        typing?: boolean;
        visible?: boolean;
      };
    }
  | {
      type: "browserPresentation";
      browserRunId: string;
      workspaceId: string;
      conversationId: string;
      mode: BrowserPresentationMode;
    }
  | (BrowserConversationMessage<"browserClosed"> & { browserRunId: string })
  | {
      type: "browserRuns";
      workspaceId: string;
      runs: BrowserRunRecord[];
    }
  | { type: "runtimeNotice"; workspaceId: string; notice: RuntimeNotice }
  | {
      type: "integrationSetupProgress";
      workspaceId: string;
      conversationId: string;
      progress: IntegrationSetupProgress;
    }
  | {
      type: "onboardingWorkBootstrapped";
      workspaceId: string;
      requestId: string;
      chatId: string;
    }
  | {
      type: "workspaceFiles";
      workspaceId: string;
      files: WorkspaceFileRecord[];
    }
  | {
      type: "workspaceFile";
      workspaceId: string;
      file: WorkspaceFileSnapshot;
      requestId: string;
    }
  | {
      type: "workspaceFileSaved";
      workspaceId: string;
      file: WorkspaceFileSnapshot;
      requestId: string;
    }
  | {
      type: "workspaceFileDeleted";
      workspaceId: string;
      fileId: string;
      requestId: string;
    }
  | {
      type: "workspaceEmailPreview";
      workspaceId: string;
      fileId: string;
      requestId: string;
      versionId: string;
      html: string;
      text: string;
    }
  | {
      type: "workspaceData";
      workspaceId: string;
      revision: number;
      prospects: ProspectRecord[];
      trends: TrendRecord[];
      analyticsDatasets: AnalyticsDataset[];
      drafts: ContentDraftRecord[];
      campaigns: CampaignRecord[];
      recurringWork: RecurringWorkRecord[];
      activity: SessionRecord[];
      actionItems: ActionItem[];
      waysOfWorking: WorkspaceWaysOfWorking;
    }
  | {
      type: "workspaceWaysOfWorkingSaved";
      workspaceId: string;
      requestId: string;
      waysOfWorking: WorkspaceWaysOfWorking;
    }
  | {
      type: "missionControlHeartbeatStarted";
      workspaceId: string;
      requestId: string;
      channelId: string;
      messageId: string;
      threadRootId: string;
    }
  | {
      type: "recurringWorkSaved";
      workspaceId: string;
      requestId: string;
      work: RecurringWorkRecord;
    }
  | {
      type: "recurringWorkWebhookRotated";
      workspaceId: string;
      requestId: string;
      recurringWorkId: string;
      url: string;
      reachability: "local_only";
    }
  | {
      type: "diagnostics";
      workspaceId: string;
      sessions: SessionRecord[];
      events: DiagnosticEventRecord[];
    }
  | {
      type: "agentPreferences";
      workspaceId: string;
      preferences: AgentPreference[];
      requestId?: string;
    }
  | {
      type: "chats";
      workspaceId: string;
      chats: {
        id: string;
        agent: string;
        title: string;
        lastText: string;
        lastAt: number;
        driver?: DriverType;
        model?: string;
        running: boolean;
      }[];
    }
  | {
      type: "chatOpened";
      workspaceId: string;
      chatId: string;
      visibility: "user" | "private";
      /** Agent currently bound to this session. Used for authoritative live presence. */
      agentId?: string;
      parentId?: string;
      execution?: ChatExecutionSelection;
    }
  | { type: "event"; workspaceId: string; chatId: string; event: AgentEvent }
  /** Buffered transcript replayed on (re)open so clients resume mid-run. */
  | {
      type: "history";
      workspaceId: string;
      chatId: string;
      messages: ChiefUIMessage[];
      events: AgentEvent[];
      running: boolean;
    }
  | {
      type: "message";
      workspaceId: string;
      chatId: string;
      message: ChiefUIMessage;
    }
  /** Secret env keys currently present for the authenticated workspace. */
  | { type: "inputsStatus"; workspaceId: string; present: string[] }
  | {
      type: "vercelEveDestinations";
      workspaceId: string;
      requestId: string;
      catalog: VercelEveDestinationCatalog;
    }
  | {
      type: "eveAgentProvisioningProgress";
      workspaceId: string;
      requestId: string;
      progress: EveAgentProvisioningProgress;
    }
  | {
      type: "eveAgentProvisioned";
      workspaceId: string;
      requestId: string;
      result: EveAgentProvisioningResult;
    }
  | {
      type: "workspaceEnvironmentVariables";
      workspaceId: string;
      variables: WorkspaceEnvironmentVariable[];
    }
  | {
      type: "localIntegrationStatus";
      workspaceId: string;
      integrations: LocalIntegrationStatus[];
    }
  | {
      type: "plugins";
      workspaceId: string;
      plugins: AgentPluginSummary[];
      sources: {
        id: string;
        name: string;
        homepage?: string;
        enabled: boolean;
      }[];
      refreshedAt: number;
      stale: boolean;
      warning?: string;
    }
  | {
      type: "pluginAuthorization";
      workspaceId: string;
      requestId: string;
      action: PluginAuthorizationAction;
    }
  | {
      type: "integrationDisconnected";
      workspaceId: string;
      provider: "google-analytics";
      requestId: string;
    }
  | {
      type: "integrationVerified";
      workspaceId: string;
      provider: string;
      category: string;
      displayName: string;
      externalId?: string;
    }
  | {
      type: "slackChannel";
      workspaceId: string;
      state: SlackChannelState;
    }
  | {
      type: "actionRequestResolved";
      workspaceId: string;
      actionItemId: string;
      requestId: string;
      action?: ActionItem;
    }
  | {
      type: "error";
      message: string;
      code?: "deployment_not_found";
      chatId?: string;
      requestId?: string;
    };
