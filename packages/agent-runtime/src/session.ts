import { EventEmitter } from "node:events";
import { BaseDriver } from "./drivers/base.js";
import { ClaudeDriver } from "./drivers/claude.js";
import { CodexDriver } from "./drivers/codex.js";
import type { AgentDefinition, AgentEvent } from "./types.js";

export class AgentSession extends EventEmitter {
  readonly agent: AgentDefinition;
  readonly chatId: string;
  /** Backend-native session/thread id, used for resume. */
  sessionId: string | undefined;
  events: AgentEvent[] = [];
  private driver: BaseDriver;

  constructor(agent: AgentDefinition, chatId: string) {
    super();
    this.agent = agent;
    this.chatId = chatId;
    this.driver =
      agent.driver === "codex" ? new CodexDriver() : new ClaudeDriver();

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
      model: this.agent.model,
      resumeSessionId,
    });
  }

  sendPrompt(text: string) {
    return this.driver.sendPrompt(text);
  }

  respondPermission(requestId: string, behavior: "allow" | "deny") {
    this.driver.respondPermission(requestId, behavior);
  }

  interrupt() {
    return this.driver.interrupt();
  }

  async stop() {
    await this.driver.stop();
    this.removeAllListeners();
  }
}
