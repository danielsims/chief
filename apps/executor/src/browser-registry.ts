import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";

import type { BrowserTarget, ExecutionLease } from "@chief/relay-contracts";
import { AgentBrowserSession } from "@chief/browser/node";
import { agentIdSchema, workspaceIdSchema } from "@chief/relay-contracts";

import type { ExecutorConfig } from "./config";
import { executionRoot } from "./paths";

export class BrowserRegistry {
  private readonly sessions = new Map<
    string,
    { generation: number; session: AgentBrowserSession }
  >();

  constructor(private readonly config: ExecutorConfig) {}

  session(lease: Pick<ExecutionLease, "agentId" | "workspaceId">) {
    const key = `${lease.workspaceId}:${lease.agentId}`;
    const existing = this.sessions.get(key);
    if (existing) return existing.session;
    return this.replaceSession(lease, 0);
  }

  private replaceSession(
    lease: Pick<ExecutionLease, "agentId" | "workspaceId">,
    generation?: number,
  ) {
    const key = `${lease.workspaceId}:${lease.agentId}`;
    const nextGeneration =
      generation ?? (this.sessions.get(key)?.generation ?? 0) + 1;
    const directory = path.join(
      executionRoot(this.config.EXECUTOR_ROOT, lease),
      "browser",
    );
    const restoreKey = `${lease.workspaceId}-${lease.agentId}`;
    const session = new AgentBrowserSession({
      sessionId: `${restoreKey}-${nextGeneration}`,
      downloadPath: directory,
      encryptionKey: this.config.COMPUTER_BROWSER_ENCRYPTION_KEY,
      executablePath: this.config.CHROMIUM_EXECUTABLE_PATH,
      restore: restoreKey,
      colorScheme: "dark",
    });
    this.sessions.set(key, { generation: nextGeneration, session });
    return session;
  }

  async open(lease: ExecutionLease, url: string, fresh: boolean) {
    assertBrowserUrlAllowed(url, lease);
    let session = this.session(lease);
    if (fresh) {
      await session.close().catch(() => undefined);
      await session.clearSavedState().catch(() => undefined);
    }
    try {
      await session.open(url, { width: 1280, height: 800 });
    } catch (firstFailure) {
      void session.close().catch(() => undefined);
      session = this.replaceSession(lease);
      try {
        await session.open(url, { width: 1280, height: 800 });
      } catch (retryFailure) {
        throw new AggregateError(
          [firstFailure, retryFailure],
          "The browser could not open the page after restarting its session.",
        );
      }
    }
    return await this.snapshot(lease);
  }

  async snapshot(lease: ExecutionLease) {
    const snapshot = await this.session(lease).snapshot();
    return {
      url: snapshot.url,
      title: snapshot.title,
      text: snapshot.snapshot,
      controls: snapshot.snapshot
        .split("\n")
        .filter((line) => line.includes("ref=")),
    };
  }

  async click(lease: ExecutionLease, target: BrowserTarget) {
    await this.session(lease).click(browserLabels(target));
    return await this.snapshot(lease);
  }

  async fill(lease: ExecutionLease, target: BrowserTarget, text: string) {
    await this.session(lease).fill(browserLabels(target), text);
    return await this.snapshot(lease);
  }

  async select(lease: ExecutionLease, target: BrowserTarget, values: string[]) {
    await this.session(lease).select(browserLabels(target), values);
    return await this.snapshot(lease);
  }

  async screenshot(lease: ExecutionLease) {
    const directory = path.join(
      executionRoot(this.config.EXECUTOR_ROOT, lease),
      "browser",
    );
    await mkdir(directory, { recursive: true });
    const output = path.join(
      directory,
      `screenshot-${crypto.randomUUID()}.png`,
    );
    try {
      await this.session(lease).command(["screenshot", output], 60_000);
      return await readFile(output);
    } finally {
      await rm(output, { force: true });
    }
  }

  async close(lease: ExecutionLease) {
    await this.session(lease)
      .close()
      .catch(() => undefined);
  }

  async stream(lease: ExecutionLease) {
    return await this.session(lease).stream();
  }

  async createStreamTicket(lease: ExecutionLease) {
    await this.stream(lease);
    const expiresAt = Date.now() + 60 * 60_000;
    const ticket = await new SignJWT({
      workspaceId: lease.workspaceId,
      agentId: lease.agentId,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setAudience("chief-computer-stream")
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt / 1_000))
      .sign(
        new TextEncoder().encode(this.config.COMPUTER_BROWSER_STREAM_SECRET),
      );
    const publicUrl = new URL(this.config.COMPUTER_PUBLIC_URL);
    publicUrl.protocol = publicUrl.protocol === "https:" ? "wss:" : "ws:";
    publicUrl.pathname = "/v1/browser/stream";
    publicUrl.search = new URLSearchParams({ ticket }).toString();
    return {
      streamUrl: publicUrl.toString(),
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async resolveStreamTicket(ticket: string) {
    try {
      const result = await jwtVerify(
        ticket,
        new TextEncoder().encode(this.config.COMPUTER_BROWSER_STREAM_SECRET),
        { algorithms: ["HS256"], audience: "chief-computer-stream" },
      );
      const identity = streamIdentitySchema.parse(result.payload);
      return (await this.session(identity).stream()).url;
    } catch {
      return undefined;
    }
  }
}

const streamIdentitySchema = z.object({
  workspaceId: workspaceIdSchema,
  agentId: agentIdSchema,
});

function browserLabels(target: BrowserTarget) {
  return [
    ...(target.ref ? [target.ref.replace(/^@?/u, "@")] : []),
    ...(target.labels ?? []),
  ];
}

function assertBrowserUrlAllowed(raw: string, lease: ExecutionLease) {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The browser only opens HTTP and HTTPS addresses.");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (!loopbackHostname(hostname) && privateHostname(hostname)) {
    throw new Error("The browser cannot open private network addresses.");
  }
  if (!lease.capabilities.includes("network:egress")) {
    throw new Error("The execution lease does not grant network access.");
  }
  const allowed = lease.network.allowedHosts.some(
    (candidate) =>
      candidate === "*" ||
      hostname === candidate ||
      hostname.endsWith(`.${candidate}`),
  );
  if (lease.network.mode !== "allow-list" || !allowed) {
    throw new Error("The browser host is not allowed by this lease.");
  }
}

function privateHostname(hostname: string) {
  return (
    hostname.endsWith(".local") ||
    /^(?:0|10|169\.254|192\.168)\./u.test(hostname) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./u.test(hostname) ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe80:")
  );
}

function loopbackHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname.startsWith("127.")
  );
}
