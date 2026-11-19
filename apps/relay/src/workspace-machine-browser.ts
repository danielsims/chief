import { z } from "zod";

import type { AgentBrowser, AgentBrowserTarget } from "@chief/agent-computer";
import type { AgentJob } from "@chief/relay-contracts";
import { RecoverableToolError } from "@chief/agent-runtime/durable-turn";
import {
  browserSnapshotSchema,
  browserStreamSchema,
  isJsonString,
  jobConversationId,
} from "@chief/relay-contracts";

import { hostedPrincipal } from "./agent-object-values";
import { workspaceOperation } from "./hosted-agent-tools/toolkits/channels";

/**
 * The browser an agent shows in a thread: one per agent per conversation
 * thread, so a later run carries on in the page the person is already
 * watching rather than opening another, as relay-cell agents' cards do.
 * Derived, not chosen: the model can't pick it, and the session ID carries
 * no secret (viewers still need tickets).
 */
export async function threadBrowserSessionId(job: AgentJob) {
  const threadRootId = isJsonString(job.payload.threadRootId)
    ? job.payload.threadRootId
    : "";
  const seed = `browser:${hostedPrincipal(job).agentId}:${jobConversationId(job)}:${threadRootId}`;
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)),
  ).slice(0, 16);
  // RFC 9562 version 8 (custom) and variant bits.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4),
    hex.slice(4, 6),
    hex.slice(6, 8),
    hex.slice(8, 10),
    hex.slice(10),
  ]
    .map((part) => part.join(""))
    .join("-");
}

/** The model cannot choose either the agent identity or the session ID sent
 * over the authenticated relay seam. */
export class WorkspaceMachineBrowser implements AgentBrowser {
  private session?: Promise<string>;
  constructor(
    private readonly env: Env,
    private readonly job: AgentJob,
  ) {}
  private sessionId() {
    return (this.session ??= threadBrowserSessionId(this.job));
  }
  private async command(
    operation: string,
    body: {
      url?: string;
      target?: AgentBrowserTarget;
      text?: string;
      values?: readonly string[];
    } = {},
    sessionId?: string,
  ) {
    sessionId ??= await this.sessionId();
    try {
      return await workspaceOperation(
        this.env,
        this.job,
        hostedPrincipal(this.job),
        "machine-browser",
        {
          body: {
            ...body,
            operation,
            sessionId,
            conversationId: jobConversationId(this.job),
          },
        },
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
  async read(url: string) {
    // Its own session, so reading never navigates the page a person is
    // watching, and no browser card is published for it.
    const sessionId = crypto.randomUUID();
    try {
      return browserSnapshotSchema.parse(
        await this.command("open", { url }, sessionId),
      );
    } finally {
      await this.command("close", {}, sessionId).catch(() => undefined);
    }
  }
  /** Where the session can be watched live, when its machine streams. */
  async stream() {
    try {
      return browserStreamSchema.parse(
        await workspaceOperation(
          this.env,
          this.job,
          hostedPrincipal(this.job),
          "machine-browser-stream",
          { body: { sessionId: await this.sessionId() } },
        ),
      );
    } catch {
      return undefined;
    }
  }
  async close() {
    z.object({ closed: z.literal(true) }).parse(await this.command("close"));
  }
}
