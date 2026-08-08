import type { AgentBrowserSession } from "@chief/browser/node";

import type { BrowserRunRecord } from "./types.js";

interface Viewport {
  width: number;
  height: number;
}

export function commandTargetsActiveBrowserRun(
  activeRunId: string | undefined,
  requestedRunId: string,
) {
  return activeRunId === requestedRunId;
}

/** Keep only the newest resumable run for each conversation. */
export function resumableBrowserRuns(runs: readonly BrowserRunRecord[]) {
  const latest = new Map<string, BrowserRunRecord>();
  for (const run of runs) {
    if (run.status !== "active") continue;
    const current = latest.get(run.conversationId);
    if (
      !current ||
      run.createdAt > current.createdAt ||
      (run.createdAt === current.createdAt && run.id > current.id)
    ) {
      latest.set(run.conversationId, run);
    }
  }
  return [...latest.values()];
}

/**
 * Resolve the Chrome profile to copy for an integration setup browser run.
 *
 * The default is fully isolated: the setup browser never loads the user's real
 * Chrome profile, so it never surfaces their personal signed-in sessions or
 * invites an authentication-mismatch. The agent authenticates once per setup,
 * Chief stores the credentials in the workspace vault, and later runs use those
 * credentials instead of a persisted browser session.
 *
 * Set CHIEF_BROWSER_PROFILE to a Chrome profile name/directory to deliberately
 * attach a real profile (for example an account an agent should drive on a
 * schedule without re-authenticating), or to "none" to force isolation when an
 * environment sets the variable globally.
 */
export function integrationBrowserProfile(setting?: string) {
  const configured = setting?.trim();
  if (!configured || configured === "none") return undefined;
  return configured;
}

export class BrowserSessionRegistry {
  private readonly sessions = new Map<string, AgentBrowserSession>();
  private readonly viewportWaiters = new Map<
    string,
    (viewport?: Viewport) => void
  >();
  private readonly pendingViewports = new Map<string, Viewport>();
  private readonly appliedViewports = new Map<string, Viewport>();
  private readonly resizeTasks = new Map<string, Promise<void>>();

  constructor(
    private readonly create: (
      workspaceId: string,
      conversationId: string,
    ) => AgentBrowserSession,
  ) {}

  key(workspaceId: string, conversationId: string) {
    return `${workspaceId}\0${conversationId}`;
  }

  session(workspaceId: string, conversationId: string) {
    const key = this.key(workspaceId, conversationId);
    const current = this.sessions.get(key);
    if (current) return current;
    const session = this.create(workspaceId, conversationId);
    this.sessions.set(key, session);
    return session;
  }

  async close(workspaceId: string, conversationId: string) {
    const key = this.key(workspaceId, conversationId);
    const session = this.sessions.get(key);
    this.sessions.delete(key);
    this.viewportWaiters.delete(key);
    this.resizeTasks.delete(key);
    this.pendingViewports.delete(key);
    this.appliedViewports.delete(key);
    if (session) await session.close().catch(() => undefined);
  }

  /** End a session and deliberately forget its encrypted restore state. */
  async reset(workspaceId: string, conversationId: string) {
    const key = this.key(workspaceId, conversationId);
    const session =
      this.sessions.get(key) ?? this.create(workspaceId, conversationId);
    this.sessions.delete(key);
    this.viewportWaiters.delete(key);
    this.resizeTasks.delete(key);
    this.pendingViewports.delete(key);
    this.appliedViewports.delete(key);
    await session.close().catch(() => undefined);
    // A fresh browser must fail closed if its old authentication state cannot
    // be removed; silently continuing could reopen the identity being reset.
    await session.clearSavedState();
  }

  async closeAll() {
    await Promise.all(
      [...this.sessions.values()].map((session) =>
        session.close().catch(() => undefined),
      ),
    );
    this.sessions.clear();
    this.viewportWaiters.clear();
    this.pendingViewports.clear();
    this.appliedViewports.clear();
    this.resizeTasks.clear();
  }

  resize(workspaceId: string, conversationId: string, viewport: Viewport) {
    const key = this.key(workspaceId, conversationId);
    const applied = this.appliedViewports.get(key);
    const pending = this.pendingViewports.get(key);
    if (
      (applied?.width === viewport.width &&
        applied.height === viewport.height) ||
      (pending?.width === viewport.width && pending.height === viewport.height)
    ) {
      return this.resizeTasks.get(key) ?? Promise.resolve();
    }
    this.pendingViewports.set(key, viewport);
    const current = this.resizeTasks.get(key);
    if (current) return current;
    const task = (async () => {
      while (this.pendingViewports.has(key)) {
        const next = this.pendingViewports.get(key);
        this.pendingViewports.delete(key);
        if (next) {
          await this.session(workspaceId, conversationId).setViewport(
            next.width,
            next.height,
          );
          this.appliedViewports.set(key, next);
        }
      }
    })().finally(() => this.resizeTasks.delete(key));
    this.resizeTasks.set(key, task);
    return task;
  }

  resolveViewport(
    workspaceId: string,
    conversationId: string,
    viewport: Viewport,
  ) {
    const waiter = this.viewportWaiters.get(
      this.key(workspaceId, conversationId),
    );
    if (!waiter) return false;
    waiter(viewport);
    return true;
  }

  waitForViewport(
    workspaceId: string,
    conversationId: string,
    onPrepare: () => void,
  ) {
    const key = this.key(workspaceId, conversationId);
    return new Promise<Viewport | undefined>((resolve) => {
      const timer = setTimeout(() => {
        this.viewportWaiters.delete(key);
        resolve(undefined);
      }, 750);
      this.viewportWaiters.set(key, (viewport) => {
        clearTimeout(timer);
        this.viewportWaiters.delete(key);
        resolve(viewport);
      });
      onPrepare();
    });
  }
}
