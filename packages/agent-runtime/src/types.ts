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

/**
 * Marketer's persistent custom UI parts follow AI SDK 7's typed `data-*`
 * contract. The websocket transport remains provider-neutral; every driver
 * can emit the same chart part and every client can render it consistently.
 */
export type MarketerUIMessage = UIMessage<
  unknown,
  { chart: GenerativeChartData }
>;

export type GenerativeChartBlock = Extract<
  MarketerUIMessage["parts"][number],
  { type: "data-chart" }
>;

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | GenerativeChartBlock
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
  | { type: "message"; role: "assistant" | "user"; content: ContentBlock[] }
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
  options: AgentQuestionOption[];
}

export type DriverType = "claude" | "codex" | "opencode";

export interface ProviderModelOption {
  value: string;
  label: string;
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
  agentId: string;
  title: string;
  instructions: string;
  cron: string;
  timezone: string;
  status: RecurringWorkStatus;
  /** Where approved runs execute: this Mac's scheduler or the deployment. */
  placement: "local" | "cloud";
  approvalSummary: string;
  proposedToolPatterns: string[];
  grant?: AutomationGrant;
  nextRunAt?: number;
  lastRunAt?: number;
  lastResult?: string;
  createdAt: number;
  updatedAt: number;
  /** Computed by the runtime for calendar rendering, never persisted. */
  upcomingRuns?: number[];
}

export interface RecurringWorkRunRecord {
  id: string;
  recurringWorkId: string;
  status: "running" | "completed" | "failed" | "needs_approval";
  scheduledFor: number;
  startedAt: number;
  finishedAt?: number;
  summary?: string;
  error?: string;
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
  | "campaign-memory";

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
 * state, resolved per session at openSession time — never part of the
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
  instructions: string;
  access: AccessMode;
  /** Workspace-scoped execution environment, including ephemeral secrets. */
  env?: Record<string, string>;
  model?: string;
  resumeSessionId?: string;
  mcpServers?: McpServerSpec[];
  /** Durable, user-authored delegation used only by unattended runs. */
  automationGrant?: AutomationGrant;
}

// ---- Structured user input (secrets/config the agent cannot obtain itself) ----

/**
 * One value the user pastes. `save` tells the runtime where to store it:
 * a file path (secrets never enter the model transcript; agents read them
 * from disk) or a workspace-scoped Keychain entry. A future deployment
 * target (e.g. Vercel env) slots in as another save variant.
 */
export interface InputField {
  key: string;
  label: string;
  type?: "text" | "secret" | "multiline";
  save: { file: string } | { envKey: string };
}

/**
 * Emitted by agents as a MARKETER_INPUT_REQUEST line and rendered by the app
 * as a form: title, web-only steps (each ideally a single click via `url`),
 * and the fewest paste fields possible.
 */
export interface InputRequest {
  id: string;
  title: string;
  reason?: string;
  steps?: Array<{ text: string; url?: string }>;
  fields: InputField[];
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
      type: "saveAgentPreference";
      workspaceId: string;
      preference: AgentPreference;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "setChatPreferences";
      workspaceId: string;
      chatId: string;
      driver: DriverType;
      model?: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "openSession";
      /** Brand/setup context markdown composed into the system prompt. */
      workspaceContext?: string;
      agentId: string;
      chatId: string;
      resumeSessionId?: string;
      /** Resolved by the client: per-chat choice > per-agent override > workspace provider. Never defaulted by the runtime. */
      driver: DriverType;
      model?: string;
      capabilities?: AgentCapabilityId[];
      /** Connected integration ids assigned to this agent. */
      integrations?: string[];
      /** Defaults to "guarded" (approval policy applies). */
      access?: AccessMode;
      /** Better Auth organization id used to isolate Executor's workspace. */
      workspaceId?: string;
      /** Opaque workspace credential stored by Executor, never sent to a model. */
      executorCapability?: ExecutorCapability;
    }
  | { type: "prompt"; chatId: string; text: string }
  | { type: "closeSession"; chatId: string }
  | {
      type: "deleteSession";
      chatId: string;
      workspaceId: string;
      executorCapability: ExecutorCapability;
    }
  | { type: "interrupt"; chatId: string }
  | {
      type: "respondPermission";
      chatId: string;
      requestId: string;
      behavior: "allow" | "deny";
    }
  /** Answers for an agent question, keyed by question text; null dismisses. */
  | {
      type: "respondQuestion";
      chatId: string;
      requestId: string;
      answers: Record<string, string> | null;
    }
  /** User submitted values for an agent's input request; the runtime stores
   * them per each field's `save` target and tells the agent where. */
  | {
      type: "provideInput";
      chatId: string;
      request: InputRequest;
      values: Record<string, string>;
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
    };

export type ServerMessage =
  | { type: "agents"; agents: AgentDefinition[] }
  | { type: "models"; driver: DriverType; models: ProviderModelOption[] }
  | {
      type: "workspaceData";
      workspaceId: string;
      prospects: ProspectRecord[];
      trends: TrendRecord[];
      drafts: ContentDraftRecord[];
      campaigns: CampaignRecord[];
      recurringWork: RecurringWorkRecord[];
      recurringWorkRuns: RecurringWorkRunRecord[];
    }
  | {
      type: "agentPreferences";
      workspaceId: string;
      preferences: AgentPreference[];
    }
  | {
      type: "chats";
      workspaceId: string;
      chats: Array<{
        id: string;
        agentId: string;
        title: string;
        lastText: string;
        lastAt: number;
        driver?: DriverType;
        model?: string;
      }>;
    }
  | { type: "sessionOpened"; chatId: string; agentId: string }
  | { type: "event"; chatId: string; event: AgentEvent }
  /** Buffered transcript replayed on (re)open so clients resume mid-run. */
  | { type: "history"; chatId: string; events: AgentEvent[] }
  /** Secret env keys currently present for the authenticated workspace. */
  | { type: "inputsStatus"; workspaceId: string; present: string[] }
  | { type: "error"; message: string; chatId?: string };
