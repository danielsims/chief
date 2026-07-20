/* eslint-disable max-lines */

import type { UIMessage } from "ai";

// Normalized event vocabulary across all drivers (claude, codex, ...).
// Content blocks mirror the shape both the Claude Agent SDK and the UI expect.

export interface GenerativeChartPoint {
  x: string;
  value: number;
}

export interface GenerativeChartSeries {
  id: string;
  label: string;
  points: GenerativeChartPoint[];
}

export interface GenerativeChartData {
  kind: "line";
  title: string;
  subtitle?: string;
  xLabel?: string;
  yLabel: string;
  series: GenerativeChartSeries[];
}

export interface GenerativeTableData {
  title: string;
  subtitle?: string;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | boolean | null>[];
}

export type AnalyticsMetricFormat =
  "number" | "currency" | "percent" | "duration";

export interface AnalyticsMetricDefinition {
  key: string;
  label: string;
  format: AnalyticsMetricFormat;
  unit?: string;
  currency?: string;
}

export interface AnalyticsDimensionDefinition {
  key: string;
  label: string;
}

export interface AnalyticsMetricValue {
  metric: string;
  value: number;
}

export interface AnalyticsDatasetPeriod {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
  values: AnalyticsMetricValue[];
}

export interface AnalyticsDatasetRow {
  dimensions: { dimension: string; value: string }[];
  values: AnalyticsMetricValue[];
}

export interface AnalyticsDatasetSeries extends GenerativeChartSeries {
  metric: string;
}

export interface AnalyticsDatasetChart {
  kind: "line";
  title: string;
  subtitle?: string;
  xLabel?: string;
  yLabel: string;
  series: string[];
}

export interface AnalyticsDataset {
  provider: string;
  key: string;
  sourceId?: string;
  title: string;
  description?: string;
  metrics: AnalyticsMetricDefinition[];
  dimensions: AnalyticsDimensionDefinition[];
  periods: AnalyticsDatasetPeriod[];
  rows?: AnalyticsDatasetRow[];
  series?: AnalyticsDatasetSeries[];
  charts?: AnalyticsDatasetChart[];
  provenance?: {
    operation?: string;
    query?: { key: string; value: string }[];
    notes?: string;
  };
  capturedAt: number;
}

export interface WorkspaceFileRecord {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  kind: "document" | "email";
  provider: "local";
  currentVersionId: string;
  createdBy: "agent" | "user";
  sourceAgentId?: string;
  sourceSessionId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceFileSnapshot extends WorkspaceFileRecord {
  content: string;
}

export interface WorkspaceFileWrite {
  id?: string;
  name: string;
  path?: string;
  mimeType?: string;
  kind?: "document" | "email";
  content: string;
  expectedVersionId?: string;
  createdBy: "agent" | "user";
  sourceAgentId?: string;
  sourceSessionId?: string;
}

export interface GenerativeDocumentData {
  fileId: string;
  title: string;
  path: string;
  kind: "document" | "email";
  versionId: string;
}

/**
 * Chief's persistent custom UI parts follow AI SDK 7's typed `data-*`
 * contract. The websocket transport remains provider-neutral; every driver
 * can emit the same chart part and every client can render it consistently.
 */
export type ChiefMessageEventMetadata =
  | {
      type: "result";
      ok: boolean;
      costUsd?: number;
      durationMs?: number;
      error?: string;
    }
  | {
      type: "error";
      message: string;
      code?: "deployment_not_found";
    }
  | {
      type: "permissionResolved";
      requestId: string;
      behavior: "allow" | "deny";
    };

export interface ChiefMessageMetadata {
  createdAt: number;
  event?: ChiefMessageEventMetadata;
}

export type ChiefUIMessage = UIMessage<
  ChiefMessageMetadata,
  {
    chart: GenerativeChartData;
    table: GenerativeTableData;
    document: GenerativeDocumentData;
  }
>;

export type GenerativeChartBlock = Extract<
  ChiefUIMessage["parts"][number],
  { type: "data-chart" }
>;

export type GenerativeTableBlock = Extract<
  ChiefUIMessage["parts"][number],
  { type: "data-table" }
>;

export type GenerativeDocumentBlock = Extract<
  ChiefUIMessage["parts"][number],
  { type: "data-document" }
>;

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | GenerativeChartBlock
  | GenerativeTableBlock
  | GenerativeDocumentBlock
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: unknown;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: unknown;
      is_error?: boolean;
    };

export type AgentEvent =
  | { type: "init"; sessionId: string; model?: string }
  | { type: "stream"; text: string }
  | {
      type: "toolProgress";
      toolUseId: string;
      text: string;
    }
  | {
      type: "message";
      id?: string;
      role: "assistant" | "user";
      content: ContentBlock[];
    }
  | {
      type: "result";
      ok: boolean;
      costUsd?: number;
      durationMs?: number;
      error?: string;
    }
  | {
      type: "permission";
      requestId: string;
      toolName: string;
      input: unknown;
    }
  /** Emitted once a permission request has been answered, so replayed
   * transcripts don't resurrect stale approval prompts. */
  | {
      type: "permissionResolved";
      requestId: string;
      behavior: "allow" | "deny";
    }
  /** The agent asked the user structured questions (Claude's
   * AskUserQuestion); the UI renders them and answers via respondQuestion. */
  | {
      type: "question";
      requestId: string;
      questions: AgentQuestion[];
    }
  | { type: "questionResolved"; requestId: string }
  | { type: "status"; status: AgentStatus }
  | { type: "error"; message: string }
  | { type: "exit"; code: number | null };

export type AgentStatus = "idle" | "running" | "waiting" | "error";

export interface AgentQuestionOption {
  label: string;
  description?: string;
}

export interface AgentQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  allowFreeform?: boolean;
  dismissible?: boolean;
  options: AgentQuestionOption[];
}

export type DriverType = "claude" | "codex" | "opencode" | "remote";

export interface ProviderModelOption {
  value: string;
  label: string;
  description?: string;
  contextWindow?: number;
  tags?: string[];
  pricing?: { input?: string; output?: string };
}

export interface ChatExecutionSelection {
  driver: DriverType;
  model?: string;
}

export interface ProspectRecord {
  id: string;
  name: string;
  company?: string;
  source: string;
  sourceUrl?: string;
  summary: string;
  relevance: "high" | "medium" | "low";
  status: "new" | "researching" | "contacted" | "dismissed";
  foundAt: number;
}

export interface TrendRecord {
  id: string;
  title: string;
  source: string;
  sourceUrl?: string;
  summary: string;
  signal: "high" | "medium" | "low";
  status: "new" | "watching" | "acted" | "dismissed";
  foundAt: number;
}

export interface ContentDraftRecord {
  id: string;
  agentId: string;
  title: string;
  body: string;
  platform: string;
  /** Editable workspace document containing the canonical draft body. */
  fileId?: string;
  status: "draft" | "approved" | "scheduled" | "published";
  scheduledFor?: number;
  createdAt: number;
  updatedAt: number;
}

export type RecurringWorkStatus =
  "draft" | "active" | "paused" | "needs_approval" | "error";

export interface AutomationGrant {
  version: 1;
  approvedAt: number;
  /** Exact Executor tool addresses the user delegated to this automation. */
  toolPatterns: string[];
}

export interface RecurringWorkRecord {
  id: string;
  /** User-visible conversation that owns this schedule's concise outcomes. */
  conversationId?: string;
  /** Optional specialist routing hint. The CMO still owns and executes work. */
  agentId: string;
  title: string;
  instructions: string;
  cron: string;
  timezone: string;
  /** Exact occurrence for work that runs once rather than recurring. */
  onceAt?: number;
  status: RecurringWorkStatus;
  /** Where approved sessions execute: this Mac's scheduler or the deployment. */
  placement: "local" | "cloud";
  /** Occurrence dates (YYYY-MM-DD in the work's timezone) the user skipped. */
  skipDates?: string[];
  approvalSummary: string;
  proposedToolPatterns: string[];
  grant?: AutomationGrant;
  nextAt?: number;
  lastCompletedAt?: number;
  lastSummary?: string;
  createdAt: number;
  updatedAt: number;
  /** Computed by the runtime for calendar rendering, never persisted. */
  upcomingRuns?: number[];
}

export interface OnboardingWorkJob {
  id: string;
  agentId: string;
  title: string;
  instructions: string;
  runAt: number;
  timezone: string;
  proposedToolPatterns: string[];
  setupDomain?: string;
  setupAttemptId?: string;
  attachments?: {
    name: string;
    type: string;
    dataUrl: string;
  }[];
}

export interface OnboardingSchedule {
  id: string;
  playbookId: string;
  agentId: string;
  title: string;
  instructions: string;
  cron: string;
  timezone: string;
  status: "active" | "draft";
  approvalSummary: string;
  proposedToolPatterns: string[];
}

export interface SessionRecord {
  id: string;
  parentId?: string;
  triggerId?: string;
  scheduleId?: string;
  kind: "conversation" | "task";
  visibility: "user" | "private";
  agent: string;
  title: string;
  /** Included only in diagnostic session snapshots. */
  lastText?: string;
  provider: string;
  model?: string;
  status:
    "idle" | "running" | "waiting" | "completed" | "failed" | "needs_approval";
  scheduledFor?: number;
  startedAt?: number;
  finishedAt?: number;
  attempt: number;
  summary?: string;
  error?: string;
  artifacts?: SessionArtifact[];
  blockedTools?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface DiagnosticEventRecord {
  id: string;
  sessionId: string;
  position: number;
  type: string;
  level: "debug" | "info" | "warn" | "error";
  data: unknown;
  createdAt: number;
}

export type SessionArtifact =
  GenerativeChartBlock | GenerativeTableBlock | GenerativeDocumentBlock;

export interface ActionItem {
  id: string;
  agentId: string;
  title: string;
  reason: string;
  sourceId?: string;
  request?: InputRequest;
  status: "open" | "dismissed";
  createdAt: number;
}

export interface ScheduleSessionActionTransition {
  upsert?: ActionItem;
  dismissIds?: string[];
}

export type CampaignStatus =
  "draft" | "in_review" | "live" | "paused" | "completed";

export interface CampaignRecord {
  id: string;
  name: string;
  provider: string;
  objective?: string;
  status: CampaignStatus;
  currency: string;
  budget?: number;
  spend?: number;
  revenue?: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentPreference {
  agentId: string;
  enabled: boolean;
  driver?: DriverType;
  model?: string;
  capabilities?: AgentCapabilityId[];
  integrations?: string[];
}

export type AgentCapabilityId =
  | "analytics-chart"
  | "prospect-memory"
  | "trend-memory"
  | "content-calendar"
  | "campaign-memory"
  | "schedule-manager";

/**
 * How much the session may do without asking. "guarded" routes mutating tool
 * calls through the approval policy (normal chats); "full" skips approvals
 * and sandboxing entirely (setup runs the user explicitly kicked off, where
 * installs, browser opens and localhost callbacks must just work).
 */
export type AccessMode = "full" | "guarded";

/** Provider-neutral tool server description understood by every driver. */
export interface McpServerSpec {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  /**
   * Streamable-HTTP endpoint for the same server, for clients whose MCP
   * support is http/sse only (OpenCode's ACP). Stdio-capable drivers keep
   * using command/args.
   */
  url?: string;
  headers?: Record<string, string>;
}

/** Bootstrap material passed only across the loopback desktop/runtime socket. */
export interface ExecutorCapability {
  apiBaseUrl: string;
  token: string;
}

/**
 * A provider-agnostic persona. Which driver/model executes it is workspace
 * state, resolved when the runtime opens a chat, never part of the
 * definition.
 */
export interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  /** One-line summary shown in lists. */
  description: string;
  /** System prompt appended to the driver's base prompt. */
  instructions: string;
  /** Uncomposed persona used when workspace capability assignments change. */
  baseInstructions?: string;
  /** Optional, composable tool + UI behaviors available to this agent. */
  capabilities?: AgentCapabilityId[];
  /** The CMO orchestrator can delegate to these agent ids. */
  delegates?: string[];
}

export interface StartOptions {
  cwd: string;
  /** Stable provider storage identity for this Chief chat. */
  storageKey?: string;
  instructions: string;
  /** Dynamic identifiers for this runtime session, separate from deployed grounding. */
  runtimeContext?: string;
  access: AccessMode;
  /** Workspace-scoped execution environment, including ephemeral secrets. */
  env?: Record<string, string>;
  model?: string;
  resumeSessionId?: string;
  /** Driver-owned durable continuation state (Eve cursor, transport target). */
  resumeState?: unknown;
  /** Normalized transcript available when a remote session starts fresh. */
  history?: AgentEvent[];
  mcpServers?: McpServerSpec[];
  /** Durable, user-authored delegation used only by unattended runs. */
  automationGrant?: AutomationGrant;
}

// ---- Structured user input (secrets/config the agent cannot obtain itself) ----

/**
 * One value the user pastes. `save` tells the runtime where to store it:
 * a file path (secrets never enter the model transcript; agents read them
 * from disk), a workspace-scoped Keychain entry, or durable non-secret
 * workspace context. A future deployment target slots in as another variant.
 */
export interface InputField {
  key: string;
  label: string;
  type?: "text" | "secret" | "multiline";
  save: { file: string } | { envKey: string } | { contextKey: string };
}

/**
 * Emitted by agents as a CHIEF_INPUT_REQUEST line and rendered by the app
 * as a form: title, web-only steps (each ideally a single click via `url`),
 * and the fewest paste fields possible.
 */
export interface InputRequest {
  id: string;
  title: string;
  reason?: string;
  steps?: { text: string; url?: string }[];
  questions?: AgentQuestion[];
  fields: InputField[];
  /** Runtime signature for context writes. Models cannot authorize these. */
  contextAuthorization?: string;
}

/** Metadata only. Secret values never cross the runtime protocol. */
export interface WorkspaceEnvironmentVariable {
  key: string;
  sensitive: true;
}

export interface LocalIntegrationStatus {
  provider: string;
  category: string;
  status: "connected" | "needs-authorization" | "unavailable";
  displayName?: string;
  externalId?: string;
  needsCredentials?: boolean;
}

export type AgentDeploymentTarget = "vercel" | "convex";

export type AgentDeploymentPhase =
  | "authenticating"
  | "preparing"
  | "linking"
  | "configuring"
  | "building"
  | "deploying"
  | "verifying";

export type AgentDeploymentStatus =
  "needs_configuration" | "running" | "ready" | "failed" | "canceled";

export interface AgentDeploymentRecord {
  id: string;
  workspaceId: string;
  target: AgentDeploymentTarget;
  projectName: string;
  teamId?: string;
  status: AgentDeploymentStatus;
  phase?: AgentDeploymentPhase;
  detail?: string;
  logs: string[];
  url?: string;
  projectId?: string;
  model?: string;
  channels?: AgentDeploymentChannel[];
  activated?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AgentDeploymentPlaybook {
  id: string;
  title: string;
  summary: string;
  instructions: string;
}

export interface AgentDeploymentChannel {
  kind: "slack";
}

export interface SlackChannelSettings {
  enabled: boolean;
  driver: Exclude<DriverType, "remote">;
  model?: string;
  allowedUserIds: string[];
  allowedChannelIds: string[];
}

export interface SlackChannelState extends SlackChannelSettings {
  configured: boolean;
  connected: boolean;
  error?: string;
}

// ---- WebSocket protocol between clients (desktop app, future Slack bridge) and the service ----

export type ClientMessage =
  | { type: "listAgents" }
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
      type: "listDiagnostics";
      workspaceId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "listWorkspaceFiles";
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
      work: RecurringWorkRecord;
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
      type: "disconnectGoogleAnalytics";
      workspaceId: string;
      requestId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "listAgentDeployments";
      workspaceId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "startAgentDeployment";
      workspaceId: string;
      target: AgentDeploymentTarget;
      projectName: string;
      teamId?: string;
      model?: string;
      playbooks: AgentDeploymentPlaybook[];
      channels?: AgentDeploymentChannel[];
      activate?: boolean;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "cancelAgentDeployment";
      workspaceId: string;
      deploymentId: string;
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
    };

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

export type ServerMessage =
  | { type: "agents"; agents: AgentDefinition[] }
  | { type: "models"; driver: DriverType; models: ProviderModelOption[] }
  | { type: "runtimeNotice"; workspaceId: string; notice: RuntimeNotice }
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
    }
  | {
      type: "chats";
      workspaceId: string;
      chats: {
        id: string;
        title: string;
        lastText: string;
        lastAt: number;
        driver?: DriverType;
        model?: string;
      }[];
    }
  | {
      type: "chatOpened";
      workspaceId: string;
      chatId: string;
      visibility: "user" | "private";
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
      type: "agentDeployments";
      workspaceId: string;
      deployments: AgentDeploymentRecord[];
    }
  | {
      type: "agentDeploymentUpdated";
      workspaceId: string;
      deployment: AgentDeploymentRecord;
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
    }
  | {
      type: "error";
      message: string;
      code?: "deployment_not_found";
      chatId?: string;
      requestId?: string;
    };
