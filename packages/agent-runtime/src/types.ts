// Normalized event vocabulary across all drivers (claude, codex, ...).
// Content blocks mirror the shape both the Claude Agent SDK and the UI expect.

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
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
  | { type: "status"; status: AgentStatus }
  | { type: "error"; message: string }
  | { type: "exit"; code: number | null };

export type AgentStatus = "idle" | "running" | "waiting" | "error";

export type DriverType = "claude" | "codex";

export interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  /** One-line summary shown in lists. */
  description: string;
  /** System prompt appended to the driver's base prompt. */
  instructions: string;
  driver: DriverType;
  model?: string;
  /** The CMO orchestrator can delegate to these agent ids. */
  delegates?: string[];
  emoji?: string;
}

export interface StartOptions {
  cwd: string;
  instructions: string;
  model?: string;
  resumeSessionId?: string;
}

// ---- WebSocket protocol between clients (desktop app, future Slack bridge) and the service ----

export type ClientMessage =
  | { type: "listAgents" }
  | { type: "openSession"; agentId: string; chatId: string; resumeSessionId?: string }
  | { type: "prompt"; chatId: string; text: string }
  | { type: "interrupt"; chatId: string }
  | {
      type: "respondPermission";
      chatId: string;
      requestId: string;
      behavior: "allow" | "deny";
    };

export type ServerMessage =
  | { type: "agents"; agents: AgentDefinition[] }
  | { type: "sessionOpened"; chatId: string; agentId: string }
  | { type: "event"; chatId: string; event: AgentEvent }
  | { type: "error"; message: string; chatId?: string };
