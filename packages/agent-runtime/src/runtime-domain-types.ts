import type { ScheduledWorkTrigger } from "@chief/channel-api";
import type { JsonObject, WorkspaceAgentRuntime } from "@chief/relay-contracts";

import type {
  AgentEvent,
  AgentQuestion,
  GenerativeChartBlock,
  GenerativeDocumentBlock,
  GenerativeTableBlock,
} from "./agent-message-types.js";

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
  evidence?: string;
  outreachAngle?: string;
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
  /** Chief-local permissions explicitly delegated to this automation. */
  localToolPermissions?: AgentToolPermission[];
}

export interface RecurringWorkRecord {
  id: string;
  missionId?: string;
  collaborators?: string[];
  expectedOutcome?: string;
  constraints?: string;
  maxDurationMinutes?: number;
  triggerMode?: "cron" | "webhook";
  /** Channel conversation where each occurrence posts its root message. */
  conversationId?: string;
  /** Agent woken by the scheduled channel message. */
  agentId: string;
  title: string;
  instructions: string;
  cron: string;
  timezone: string;
  /** Durable trigger definition. Older records derive this from cron/onceAt. */
  trigger?: ScheduledWorkTrigger;
  /** Stable caller key used to make create retries idempotent. */
  operationKey?: string;
  version?: number;
  /** Controls whether a successful unattended run creates a desktop notice. */
  notificationPolicy?: "always" | "attention-only";
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
  lastMessageId?: string;
  lastDispatchedAt?: number;
  lastCompletedAt?: number;
  lastSummary?: string;
  createdAt: number;
  updatedAt: number;
  /** Computed by the runtime for calendar rendering, never persisted. */
  upcomingRuns?: number[];
  recordedRuns?: number[];
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
  triggerContext?: JsonObject;
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

export interface ActionResolution {
  answers: Record<string, string>;
  resolvedAt: number;
  resolvedBy: { id: string; name: string };
}

export interface ActionItem {
  id: string;
  agentId: string;
  title: string;
  reason: string;
  sourceId?: string;
  /** Exact channel thread where the action was raised. Host-bound, not model-authored. */
  threadRootId?: string;
  request?: InputRequest;
  resolution?: ActionResolution;
  status: "open" | "resolved" | "dismissed";
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
  deploymentTarget?: "phone" | "desktop" | "cloud";
  driver?: DriverType;
  model?: string;
  approvals?: AgentApprovalMode;
  capabilities?: AgentCapabilityId[];
  integrations?: string[];
  /** Exact Chief-local capabilities granted to this agent identity. */
  toolPermissions?: AgentToolPermission[];
}

export type AgentToolPermission =
  | "workspace.read"
  | "workspace.write"
  | "projects.read"
  | "projects.write"
  | "machines.read"
  | "machines.write"
  | "channels.read"
  | "channels.create"
  | "channels.update"
  | "channels.archive"
  | "members.read"
  | "members.manage"
  | "messages.read"
  | "messages.send"
  | "messages.manage"
  | "schedules.read"
  | "schedules.manage"
  | "schedules.run"
  | "webhooks.manage"
  | "browser.use"
  | "integrations.manage"
  | "agents.delegate";

export type AgentApprovalMode = "auto" | "ask";

export const workspaceOperatingModes = [
  "mission-control",
  "channels",
  "calm",
] as const;

export type WorkspaceOperatingMode = (typeof workspaceOperatingModes)[number];

/**
 * A lightweight preference that shapes how agents compose Chief's existing
 * channels, threads, schedules and notifications. It is guidance, not a new
 * permission or workflow protocol.
 */
export interface WorkspaceWaysOfWorking {
  mode: WorkspaceOperatingMode;
  missionControlChannelId: string;
  updatedAt: number;
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
  /** Working directory for stdio servers. */
  cwd?: string;
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

export type * from "./eve-provisioning-types.js";

/**
 * A provider-agnostic persona. Which driver/model executes it is workspace
 * state, resolved when the runtime opens a chat, never part of the
 * definition.
 */
export interface AgentProfile {
  canMessage?: boolean;
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
}

export interface AgentDefinition extends AgentProfile {
  /** Chief can delegate to these agent ids. */
  delegates?: string[];
  /** Authored specialists packaged inside this root agent's deployment. */
  subagents?: AgentProfile[];
  /** Where this agent executes. Native cells remain the default. */
  runtime?: WorkspaceAgentRuntime;
}

export interface StartOptions {
  cwd: string;
  /** Extra workspace roots the provider may read without an approval prompt. */
  additionalDirectories?: string[];
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
  /** Maximum provider attempts for this turn, including the first attempt. */
  maxPromptAttempts?: number;
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
