import { EventEmitter } from "node:events";

import type { AgentEvent, StartOptions } from "../types.js";

/**
 * A driver adapts one local or hosted agent backend to Chief's normalized
 * event stream. The concrete driver owns authentication and continuation.
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

  protected emitState(state: unknown) {
    this.emit("state", state);
  }
}
