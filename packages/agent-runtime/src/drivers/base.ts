import { EventEmitter } from "node:events";

import type { AgentEvent, StartOptions } from "../types.js";
import {
  agentEventProducedOutput,
  promptRetryDelays,
  retryableAgentFailure,
} from "../agent-retry.js";

/**
 * A driver adapts one local or hosted agent backend to Chief's normalized
 * event stream. The concrete driver owns authentication and continuation.
 */
export abstract class BaseDriver extends EventEmitter {
  abstract start(opts: StartOptions): Promise<void>;
  /** Send one prompt through the concrete backend. May throw on failure. */
  abstract sendPromptOnce(text: string): Promise<void>;
  /** Bring the backend back to a healthy state after a failed attempt. */
  abstract restart(): Promise<void>;
  abstract interrupt(): Promise<void>;
  abstract stop(): Promise<void>;

  /** The options the backend was last started with, for restart(). */
  protected startOptions: StartOptions | undefined;
  /** Set by interrupt() so a retry loop aborts instead of resending. */
  protected interrupted = false;
  /** True when the failed attempt already produced output (retry would duplicate). */
  protected promptProducedOutput = false;
  /** Async-stream drivers finish a prompt when they emit a terminal event. */
  protected promptCompletesFromEvents = false;
  private promptCompletion:
    | {
        promise: Promise<void>;
        resolve: () => void;
        reject: (error: Error) => void;
        state: "pending" | "success" | "failure";
      }
    | undefined;

  protected producedPromptOutput(): boolean {
    return this.promptProducedOutput;
  }

  protected promptWasInterrupted(): boolean {
    return this.interrupted;
  }

  protected waitBeforeRetry(delayMs: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }

  /**
   * Wraps every driver with progressive-backoff retry so an overloaded or
   * transiently unhealthy backend (OpenCode, Codex, Claude, remote) recovers
   * instead of killing the turn. Attempts up to CHIEF_PROMPT_RETRIES (default
   * 5) with progressive backoff between attempts, restarting the backend each
   * time, and stops early after an interrupt or any output that could duplicate.
   */
  async sendPrompt(text: string): Promise<void> {
    const configuredAttempts = this.startOptions?.maxPromptAttempts;
    const retryDelays = promptRetryDelays(
      configuredAttempts === undefined
        ? process.env.CHIEF_PROMPT_RETRIES
        : String(configuredAttempts),
    );
    const maxAttempts = retryDelays.length + 1;
    this.interrupted = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.promptProducedOutput = false;
      const completion = this.promptCompletesFromEvents
        ? this.createPromptCompletion()
        : undefined;
      try {
        await this.sendPromptOnce(text);
        await completion?.promise;
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (this.promptWasInterrupted()) return;
        if (
          attempt >= maxAttempts ||
          this.producedPromptOutput() ||
          !retryableAgentFailure(error)
        ) {
          this.emitEvent({ type: "error", message });
          throw error;
        }
        const delayMs = retryDelays[attempt - 1] ?? 0;
        console.error(
          `[driver] prompt attempt ${attempt}/${maxAttempts} failed (${message}); retrying in ${delayMs}ms`,
        );
        await this.waitBeforeRetry(delayMs);
        if (this.promptWasInterrupted()) return;
        try {
          await this.restart();
        } catch {
          // The next attempt will fail and retry again.
        }
      } finally {
        if (this.promptCompletion === completion) {
          this.promptCompletion = undefined;
        }
      }
    }
  }

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
    if (agentEventProducedOutput(event)) {
      this.promptProducedOutput = true;
    }
    const completion = this.promptCompletion;
    if (completion) {
      if (event.type === "result") {
        if (event.ok) {
          completion.state = "success";
          completion.resolve();
        } else {
          completion.state = "failure";
          completion.reject(new Error(event.error ?? "The agent turn failed."));
          return;
        }
      } else if (event.type === "error") {
        completion.state = "failure";
        completion.reject(new Error(event.message));
        return;
      } else if (
        completion.state === "failure" &&
        (event.type === "exit" ||
          (event.type === "status" &&
            event.status === "idle" &&
            !this.promptWasInterrupted()))
      ) {
        return;
      }
    }
    this.emit("event", event);
  }

  protected emitState(state: unknown) {
    this.emit("state", state);
  }

  private createPromptCompletion() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    // A stream can fail while sendPromptOnce is still starting. Attach a
    // handler immediately so that early rejection is never unhandled.
    void promise.catch(() => undefined);
    const completion = {
      promise,
      resolve,
      reject,
      state: "pending" as const,
    };
    this.promptCompletion = completion;
    return completion;
  }
}
