import { EventEmitter } from "node:events";

import type { BaseDriver } from "./drivers/base.js";
import type {
  AccessMode,
  AgentDefinition,
  AgentEvent,
  DriverType,
  McpServerSpec,
} from "./types.js";
import { createDriver } from "./drivers/index.js";
import { withGenerativeDataParts } from "./generative-ui.js";

/** Per-session execution config: which backend runs the persona and how much it may do unprompted. */
export interface SessionConfig {
  driver: DriverType;
  access: AccessMode;
  workspaceId: string;
  env?: Record<string, string>;
  model?: string;
  mcpServers?: McpServerSpec[];
  automationGrant?: import("./types.js").AutomationGrant;
}

export class AgentSession extends EventEmitter {
  readonly agent: AgentDefinition;
  readonly chatId: string;
  readonly config: SessionConfig;
  /** Backend-native session/thread id, used for resume. */
  sessionId: string | undefined;
  events: AgentEvent[] = [];
  private driver: BaseDriver;
  private status: "idle" | "running" | "waiting" | "error" = "idle";
  private stallTimer: NodeJS.Timeout | null = null;
  private readonly stallTimeoutMs = 90_000;

  constructor(
    agent: AgentDefinition,
    chatId: string,
    config: SessionConfig,
    initialEvents: AgentEvent[] = [],
  ) {
    super();
    this.agent = agent;
    this.chatId = chatId;
    this.config = config;
    this.driver = createDriver(config.driver);

    this.events = initialEvents.map(withGenerativeDataParts).slice(-500);
    this.driver.on("event", (rawEvent: AgentEvent) => {
      const event = withGenerativeDataParts(rawEvent);
      if (event.type === "init") this.sessionId = event.sessionId;
      if (event.type === "status") this.status = event.status;
      if (
        event.type === "result" ||
        event.type === "error" ||
        event.type === "exit"
      ) {
        this.status = event.type === "error" ? "error" : "idle";
      }
      this.record(event);
      if (this.status === "running") this.armStallWatchdog();
      else this.clearStallWatchdog();
    });
  }

  get isBusy() {
    return this.status === "running" || this.status === "waiting";
  }

  private record(event: AgentEvent) {
    this.events.push(event);
    if (this.events.length > 500) this.events.shift();
    this.emit("event", event);
  }

  private clearStallWatchdog() {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = null;
  }

  private armStallWatchdog() {
    this.clearStallWatchdog();
    this.stallTimer = setTimeout(() => {
      if (!this.isBusy) return;
      void this.driver.interrupt().catch(() => {});
      this.status = "idle";
      this.record({
        type: "error",
        message:
          "The agent stopped after 90 seconds without any new output. You can retry the request.",
      });
      this.record({ type: "status", status: "idle" });
    }, this.stallTimeoutMs);
    this.stallTimer.unref();
  }

  async start(cwd: string, resumeSessionId?: string) {
    await this.driver.start({
      cwd,
      instructions: this.agent.instructions,
      access: this.config.access,
      env: this.config.env,
      model: this.config.model,
      resumeSessionId,
      mcpServers: this.config.mcpServers,
      automationGrant: this.config.automationGrant,
    });
  }

  sendPrompt(text: string) {
    // Record the user turn as an event so reconnecting clients can rebuild
    // the full transcript from the buffer.
    const event: AgentEvent = {
      type: "message",
      role: "user",
      content: [{ type: "text", text }],
    };
    this.events.push(event);
    this.emit("event", event);
    this.status = "running";
    this.armStallWatchdog();
    return this.driver.sendPrompt(text);
  }

  recordUserMessage(text: string) {
    this.record({
      type: "message",
      role: "user",
      content: [{ type: "text", text }],
    });
  }

  respondPermission(requestId: string, behavior: "allow" | "deny") {
    this.driver.respondPermission(requestId, behavior);
    // Record the resolution in the buffer so replayed transcripts don't
    // resurrect an approval prompt that was already answered.
    const event: AgentEvent = {
      type: "permissionResolved",
      requestId,
      behavior,
    };
    this.events.push(event);
    this.emit("event", event);
  }

  respondQuestion(requestId: string, answers: Record<string, string> | null) {
    // The driver emits questionResolved itself, so the buffer stays correct.
    this.driver.respondQuestion(requestId, answers);
  }

  interrupt() {
    return this.driver.interrupt();
  }

  async stop() {
    this.clearStallWatchdog();
    await this.driver.stop();
    this.removeAllListeners();
  }
}
