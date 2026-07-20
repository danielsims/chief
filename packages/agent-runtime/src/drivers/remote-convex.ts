import type { AgentEvent, StartOptions } from "../types.js";
import { BaseDriver } from "./base.js";
import { remoteHistoryContext } from "./remote-history.js";

interface ConvexRemoteState {
  version: 1;
  target: "convex";
  host: string;
  sessionId?: string;
  cursor: number;
  inFlight: boolean;
}

interface EventResponse {
  events: { cursor: number; event: AgentEvent }[];
  status: "running" | "completed" | "failed" | "cancelled";
}

function savedState(
  value: unknown,
  host: string,
): ConvexRemoteState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const state = value as Partial<ConvexRemoteState>;
  if (
    state.version !== 1 ||
    state.target !== "convex" ||
    state.host !== host ||
    !Number.isSafeInteger(state.cursor) ||
    (state.sessionId !== undefined && typeof state.sessionId !== "string")
  ) {
    return undefined;
  }
  return {
    version: 1,
    target: "convex",
    host,
    sessionId: state.sessionId,
    cursor: Number(state.cursor),
    inFlight: state.inFlight === true,
  };
}

function isAgentEvent(value: unknown): value is AgentEvent {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { type?: unknown }).type === "string",
  );
}

export class ConvexRemoteDriver extends BaseDriver {
  private state: ConvexRemoteState | undefined;
  private password = "";
  private abort: AbortController | undefined;
  private pumping: Promise<void> | undefined;
  private initialHistory: StartOptions["history"];

  async start(options: StartOptions) {
    const rawHost = options.env?.CHIEF_REMOTE_AGENT_URL?.trim();
    this.password = options.env?.CHIEF_EVE_ROUTE_PASSWORD?.trim() ?? "";
    if (!rawHost || !this.password) {
      throw new Error(
        "This workspace has no authenticated Convex agent deployment. Deploy it again from Agents.",
      );
    }
    const url = new URL(rawHost);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("The Convex agent URL must be an HTTPS origin.");
    }
    this.state = savedState(options.resumeState, url.origin) ?? {
      version: 1,
      target: "convex",
      host: url.origin,
      cursor: -1,
      inFlight: false,
    };
    this.initialHistory = this.state.sessionId ? undefined : options.history;
    await this.request("/v1/health");
    this.emitState(this.state);
    if (this.state.sessionId) {
      this.emitEvent({ type: "init", sessionId: this.state.sessionId });
    }
    if (this.state.inFlight && this.state.sessionId) this.beginPump();
  }

  async sendPrompt(text: string) {
    if (!this.state) throw new Error("Remote agent not started.");
    if (this.pumping || this.state.inFlight)
      throw new Error("The remote agent is already running.");
    const importedHistory = remoteHistoryContext(this.initialHistory, text);
    const prompt =
      !this.state.sessionId && importedHistory
        ? `${importedHistory}\n\nCurrent user message:\n${text}`
        : text;
    this.initialHistory = undefined;
    const response = await this.request("/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ sessionId: this.state.sessionId, prompt }),
      headers: { "content-type": "application/json" },
    });
    const body = (await response.json()) as { sessionId?: unknown };
    if (typeof body.sessionId !== "string") {
      throw new Error("Convex returned an invalid session identity.");
    }
    const first = !this.state.sessionId;
    this.state = {
      ...this.state,
      sessionId: body.sessionId,
      inFlight: true,
    };
    if (first) this.emitEvent({ type: "init", sessionId: body.sessionId });
    this.emitState(this.state);
    this.beginPump();
  }

  async interrupt() {
    if (!this.state?.sessionId) return;
    await this.request(
      `/v1/sessions/${encodeURIComponent(this.state.sessionId)}/cancel`,
      { method: "POST" },
    );
  }

  async stop() {
    this.abort?.abort();
    await this.pumping?.catch(() => undefined);
    this.abort = undefined;
    this.pumping = undefined;
  }

  private beginPump() {
    this.abort = new AbortController();
    this.pumping = this.pump(this.abort.signal).finally(() => {
      this.abort = undefined;
      this.pumping = undefined;
    });
  }

  private async pump(signal: AbortSignal) {
    if (!this.state?.sessionId) return;
    const sessionId = this.state.sessionId;
    let failures = 0;
    try {
      while (!signal.aborted && this.state.inFlight) {
        const path = `/v1/sessions/${encodeURIComponent(sessionId)}/events?after=${this.state.cursor}`;
        let response: Response;
        try {
          response = await this.request(path, { signal });
          failures = 0;
        } catch (error) {
          failures += 1;
          if (failures > 5) throw error;
          await this.wait(250 * 2 ** (failures - 1), signal);
          continue;
        }
        const body = (await response.json()) as EventResponse;
        if (!Array.isArray(body.events)) {
          throw new Error("Convex returned an invalid event page.");
        }
        for (const item of body.events) {
          if (!Number.isSafeInteger(item.cursor) || !isAgentEvent(item.event)) {
            throw new Error("Convex returned an invalid agent event.");
          }
          if (item.cursor <= this.state.cursor) continue;
          if (
            item.event.type !== "init" ||
            item.event.sessionId !== this.state.sessionId
          ) {
            this.emitEvent(item.event);
          }
          this.state = { ...this.state, cursor: item.cursor };
          this.emitState(this.state);
        }
        if (body.events.length === 100) continue;
        if (body.status !== "running") {
          this.state = { ...this.state, inFlight: false };
          this.emitState(this.state);
          return;
        }
        await this.wait(500, signal);
      }
    } catch (error) {
      if (signal.aborted) return;
      this.emitEvent({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      this.emitEvent({ type: "status", status: "idle" });
    }
  }

  private wait(delayMs: number, signal: AbortSignal) {
    if (signal.aborted) {
      return Promise.reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("Polling stopped."),
      );
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(
            signal.reason instanceof Error
              ? signal.reason
              : new Error("Polling stopped."),
          );
        },
        { once: true },
      );
    });
  }

  private async request(path: string, init: RequestInit = {}) {
    if (!this.state) throw new Error("Remote agent not started.");
    const authorization = Buffer.from(
      `chief-desktop:${this.password}`,
    ).toString("base64");
    const response = await fetch(`${this.state.host}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Basic ${authorization}`,
      },
      redirect: "error",
    });
    if (!response.ok) {
      let detail = "";
      try {
        const body = (await response.json()) as { error?: unknown };
        if (typeof body.error === "string") detail = `: ${body.error}`;
      } catch {
        // HTTP status remains precise when a proxy returns a non-JSON body.
      }
      throw new Error(
        `Convex agent request failed (${response.status})${detail}`,
      );
    }
    return response;
  }
}
