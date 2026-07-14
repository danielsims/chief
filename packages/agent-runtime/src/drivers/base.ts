import { EventEmitter } from "node:events";

import type { AgentEvent, StartOptions } from "../types.js";

/**
 * A driver adapts one coding-agent backend (Claude Code, Codex) to a
 * normalized event stream. Inference always runs on the user's own
 * subscription — drivers delegate auth to each CLI's own login.
 */
export abstract class BaseDriver extends EventEmitter {
  abstract start(opts: StartOptions): Promise<void>;
  abstract sendPrompt(text: string): Promise<void>;
  abstract interrupt(): Promise<void>;
  abstract stop(): Promise<void>;

  respondPermission(_requestId: string, _behavior: "allow" | "deny"): void {
    // default: no interactive permissions
  }

  respondQuestion(
    _requestId: string,
    _answers: Record<string, string> | null,
  ): void {
    // default: no interactive questions
  }

  protected emitEvent(event: AgentEvent) {
    this.emit("event", event);
  }
}
