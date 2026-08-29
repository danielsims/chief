import type { AgentEvent, StartOptions } from "../types.js";
import { BaseDriver } from "./base.js";
import { EveRemoteDriver } from "./remote-eve.js";

export class RemoteDriver extends BaseDriver {
  protected override promptCompletesFromEvents = true;
  private transport: BaseDriver | undefined;

  async start(options: StartOptions) {
    this.startOptions = options;
    this.transport = new EveRemoteDriver();
    this.transport.on("event", (event: AgentEvent) => this.emitEvent(event));
    this.transport.on("state", (state) => this.emitState(state));
    await this.transport.start(options);
  }

  sendPromptOnce(text: string) {
    return this.requireTransport().sendPromptOnce(text);
  }

  async restart() {
    await this.requireTransport().restart();
  }

  interrupt() {
    this.interrupted = true;
    return this.requireTransport().interrupt();
  }

  stop() {
    return this.requireTransport().stop();
  }

  respondPermission(requestId: string, behavior: "allow" | "deny") {
    this.requireTransport().respondPermission(requestId, behavior);
  }

  respondQuestion(requestId: string, answers: Record<string, string> | null) {
    this.requireTransport().respondQuestion(requestId, answers);
  }

  private requireTransport() {
    if (!this.transport) throw new Error("Remote agent not started.");
    return this.transport;
  }
}
