import { EventEmitter } from "node:events";
import { BaseDriver } from "./drivers/base.js";
import { createDriver } from "./drivers/index.js";
import type {
  AccessMode,
  AgentDefinition,
  AgentEvent,
  DriverType,
} from "./types.js";

/** Per-session execution config: which backend runs the persona and how much it may do unprompted. */
export interface SessionConfig {
  driver: DriverType;
  access: AccessMode;
  model?: string;
}

export class AgentSession extends EventEmitter {
  readonly agent: AgentDefinition;
  readonly chatId: string;
  readonly config: SessionConfig;
  /** Backend-native session/thread id, used for resume. */
  sessionId: string | undefined;
  events: AgentEvent[] = [];
  private driver: BaseDriver;

  constructor(agent: AgentDefinition, chatId: string, config: SessionConfig) {
    super();
    this.agent = agent;
    this.chatId = chatId;
    this.config = config;
    this.driver = createDriver(config.driver);

    this.driver.on("event", (event: AgentEvent) => {
      if (event.type === "init") this.sessionId = event.sessionId;
      this.events.push(event);
      if (this.events.length > 500) this.events.shift();
      this.emit("event", event);
    });
  }

  async start(cwd: string, resumeSessionId?: string) {
    await this.driver.start({
      cwd,
      instructions: this.agent.instructions,
      access: this.config.access,
      model: this.config.model,
      resumeSessionId,
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
    return this.driver.sendPrompt(text);
  }

  respondPermission(requestId: string, behavior: "allow" | "deny") {
    this.driver.respondPermission(requestId, behavior);
    // Record the resolution in the buffer so replayed transcripts don't
    // resurrect an approval prompt that was already answered.
    const event: AgentEvent = { type: "permissionResolved", requestId, behavior };
    this.events.push(event);
    this.emit("event", event);
  }

  interrupt() {
    return this.driver.interrupt();
  }

  async stop() {
    await this.driver.stop();
    this.removeAllListeners();
  }
}
