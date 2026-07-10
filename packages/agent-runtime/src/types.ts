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
  | { type: "status"; status: AgentStatus }
  | { type: "error"; message: string }
  | { type: "exit"; code: number | null };

export type AgentStatus = "idle" | "running" | "waiting" | "error";

export type DriverType = "claude" | "codex";

/**
 * How much the session may do without asking. "guarded" routes mutating tool
 * calls through the approval policy (normal chats); "full" skips approvals
 * and sandboxing entirely (setup runs the user explicitly kicked off, where
 * installs, browser opens and localhost callbacks must just work).
 */
export type AccessMode = "full" | "guarded";

/** Provider-neutral stdio tool server description understood by every driver. */
export interface McpServerSpec {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
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
  /** The CMO orchestrator can delegate to these agent ids. */
  delegates?: string[];
}

export interface StartOptions {
  cwd: string;
  instructions: string;
  access: AccessMode;
  model?: string;
  resumeSessionId?: string;
  mcpServers?: McpServerSpec[];
}

// ---- Structured user input (secrets/config the agent cannot obtain itself) ----

/**
 * One value the user pastes. `save` tells the runtime where to store it:
 * a file path (secrets never enter the model transcript; agents read them
 * from disk) or a key in ~/.marketer/secrets.env. A future deployment
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
      type: "openSession";
      agentId: string;
      chatId: string;
      resumeSessionId?: string;
      /** Resolved by the client: per-chat choice > per-agent override > workspace provider. Never defaulted by the runtime. */
      driver: DriverType;
      model?: string;
      /** Defaults to "guarded" (approval policy applies). */
      access?: AccessMode;
      /** Better Auth organization id used to isolate Executor's workspace. */
      workspaceId?: string;
      /** Opaque workspace credential stored by Executor, never sent to a model. */
      executorCapability?: ExecutorCapability;
    }
  | { type: "prompt"; chatId: string; text: string }
  | { type: "closeSession"; chatId: string }
  | { type: "deleteSession"; chatId: string }
  | { type: "interrupt"; chatId: string }
  | {
      type: "respondPermission";
      chatId: string;
      requestId: string;
      behavior: "allow" | "deny";
    }
  /** User submitted values for an agent's input request; the runtime stores
   * them per each field's `save` target and tells the agent where. */
  | {
      type: "provideInput";
      chatId: string;
      request: InputRequest;
      values: Record<string, string>;
    }
  /** Which of these secret env keys already exist in ~/.marketer/secrets.env?
   * Answered with inputsStatus. Lets the app collect required credentials
   * BEFORE any agent session starts. */
  | { type: "queryInputs"; keys: string[] }
  /** Store values with no agent session involved (pre-connect requirement
   * forms). Runtime stores them and broadcasts a fresh inputsStatus. */
  | {
      type: "storeInput";
      request: InputRequest;
      values: Record<string, string>;
    };

export type ServerMessage =
  | { type: "agents"; agents: AgentDefinition[] }
  | { type: "sessionOpened"; chatId: string; agentId: string }
  | { type: "event"; chatId: string; event: AgentEvent }
  /** Buffered transcript replayed on (re)open so clients resume mid-run. */
  | { type: "history"; chatId: string; events: AgentEvent[] }
  /** Secret env keys currently present in ~/.marketer/secrets.env. */
  | { type: "inputsStatus"; present: string[] }
  | { type: "error"; message: string; chatId?: string };
