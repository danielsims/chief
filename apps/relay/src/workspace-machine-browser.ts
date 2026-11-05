import { z } from "zod";

import type { AgentBrowser, AgentBrowserTarget } from "@chief/agent-computer";
import type { AgentJob } from "@chief/relay-contracts";
import { RecoverableToolError } from "@chief/agent-runtime/durable-turn";
import { browserSnapshotSchema } from "@chief/relay-contracts";

import { hostedPrincipal } from "./agent-object-values";
import { workspaceOperation } from "./hosted-agent-tools/toolkits/channels";

/** One job owns one ephemeral browser session. The model cannot choose either
 * the agent identity or session ID sent over the authenticated relay seam. */
export class WorkspaceMachineBrowser implements AgentBrowser {
  constructor(
    private readonly env: Env,
    private readonly job: AgentJob,
  ) {}
  private async command(
    operation: string,
    body: {
      url?: string;
      target?: AgentBrowserTarget;
      text?: string;
      values?: readonly string[];
    } = {},
  ) {
    try {
      return await workspaceOperation(
        this.env,
        this.job,
        hostedPrincipal(this.job),
        "machine-browser",
        { body: { ...body, operation, sessionId: this.job.id } },
      );
    } catch (error) {
      throw new RecoverableToolError(
        error instanceof Error ? error.message : "Browser machine unavailable.",
      );
    }
  }
  async open(url: string, options?: { fresh?: boolean }) {
    if (options?.fresh) await this.close();
    return browserSnapshotSchema.parse(await this.command("open", { url }));
  }
  async snapshot() {
    return browserSnapshotSchema.parse(await this.command("snapshot"));
  }
  async click(target: AgentBrowserTarget) {
    return browserSnapshotSchema.parse(await this.command("click", { target }));
  }
  async type(target: AgentBrowserTarget, text: string) {
    return browserSnapshotSchema.parse(
      await this.command("fill", { target, text }),
    );
  }
  async select(target: AgentBrowserTarget, values: readonly string[]) {
    return browserSnapshotSchema.parse(
      await this.command("select", { target, values }),
    );
  }
  async screenshot() {
    const value = z
      .object({
        base64: z
          .string()
          .max(866_668)
          .regex(/^[A-Za-z0-9+/]*={0,2}$/),
      })
      .parse(await this.command("screenshot"));
    return Uint8Array.from(atob(value.base64), (char) => char.charCodeAt(0));
  }
  async close() {
    z.object({ closed: z.literal(true) }).parse(await this.command("close"));
  }
}
