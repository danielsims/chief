import type { AgentBrowserSession } from "@chief/browser/node";
import type { JsonObject } from "@chief/relay-contracts";
import { isJsonString } from "@chief/relay-contracts";

import type { BrowserRunRecord, SessionRecord } from "./types.js";
import { channelIdFromChatId } from "./channels/nip29.js";

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

/** Every active run is independently resumable, even inside one conversation. */
export function resumableBrowserRuns(runs: readonly BrowserRunRecord[]) {
  return runs.filter((run) => run.status === "active");
}

interface LegacyBrowserOwnerCandidate {
  id: string;
  agent: string;
  parentId?: string;
  status: SessionRecord["status"];
  triggerContext?: JsonObject;
  createdAt: number;
}

/**
 * Repair the one legacy handoff that can be identified without guessing.
 *
 * Older Setup calls trusted a model-authored parent conversation ID, which
 * left Google sign-in attached to the channel instead of the Setup thread.
 * Only migrate an active Google auth run when one matching Setup child existed
 * before the run. Ambiguous runs remain untouched.
 */
export function legacyGoogleAuthBrowserOwner(
  run: BrowserRunRecord,
  candidates: readonly LegacyBrowserOwnerCandidate[],
) {
  if (run.status !== "active" || run.threadRootId || run.parentConversationId) {
    return undefined;
  }
  let hostname: string;
  try {
    hostname = new URL(run.url).hostname;
  } catch {
    return undefined;
  }
  if (hostname !== "accounts.google.com") return undefined;
  const matches = candidates.filter((candidate) => {
    const threadRootId = candidate.triggerContext?.threadRootId;
    return (
      candidate.parentId === run.conversationId &&
      candidate.agent === "setup" &&
      isJsonString(threadRootId) &&
      threadRootId.length > 0 &&
      candidate.createdAt <= run.createdAt
    );
  });
  if (matches.length !== 1) return undefined;
  const owner = matches[0];
  const threadRootId = owner?.triggerContext?.threadRootId;
  if (!owner || !isJsonString(threadRootId)) return undefined;
  return { conversationId: owner.id, threadRootId };
}

interface LegacyBrowserOwnerStore {
  channelStore(): {
    events(
      workspaceId: string,
      channelId: string,
    ): Promise<readonly { id: string; tags: readonly string[][] }[]>;
  };
  listChildChats(
    workspaceId: string,
    parentId: string,
  ): Promise<LegacyBrowserOwnerCandidate[]>;
  chatRecord(
    workspaceId: string,
    chatId: string,
  ): Promise<
    | (LegacyBrowserOwnerCandidate & {
        summary?: string;
      })
    | null
  >;
  updateChatState(
    workspaceId: string,
    chatId: string,
    state: {
      status: "waiting";
      finishedAt: null;
      error: null;
    },
  ): Promise<boolean>;
  updateBrowserRun(
    workspaceId: string,
    id: string,
    patch: Partial<
      Pick<
        BrowserRunRecord,
        | "anchorMessageId"
        | "conversationId"
        | "parentConversationId"
        | "status"
        | "threadRootId"
        | "title"
        | "url"
      >
    >,
  ): Promise<void>;
}

/** Move safely identifiable legacy Google handoffs before browser recovery. */
export async function repairLegacyGoogleAuthBrowserOwners(
  store: LegacyBrowserOwnerStore,
  workspaceId: string,
  runs: readonly BrowserRunRecord[],
) {
  return Promise.all(
    runs.map(async (run) => {
      let repaired = run;
      if (!run.threadRootId && !run.parentConversationId) {
        const children = await store.listChildChats(
          workspaceId,
          run.conversationId,
        );
        const owner = legacyGoogleAuthBrowserOwner(run, children);
        if (owner) {
          repaired = {
            ...run,
            conversationId: owner.conversationId,
            parentConversationId: run.conversationId,
            threadRootId: owner.threadRootId,
          };
        }
      }
      const parentId = repaired.parentConversationId;
      const channelId = parentId ? channelIdFromChatId(parentId) : null;
      if (channelId && repaired.threadRootId) {
        const events = await store
          .channelStore()
          .events(workspaceId, channelId);
        const root = events.find((event) => event.id === repaired.threadRootId);
        const sourceId = root?.tags.find((tag) => tag[0] === "client")?.[1];
        if (sourceId) repaired = { ...repaired, threadRootId: sourceId };
      }
      if (repaired.status === "active") {
        const owner = await store.chatRecord(
          workspaceId,
          repaired.conversationId,
        );
        if (
          owner?.agent === "setup" &&
          owner.status === "failed" &&
          owner.summary?.includes("pending-human-signin")
        ) {
          await store.updateChatState(workspaceId, owner.id, {
            status: "waiting",
            finishedAt: null,
            error: null,
          });
        }
      }
      if (repaired === run) return run;
      await store.updateBrowserRun(workspaceId, run.id, repaired);
      return repaired;
    }),
  );
}

/** Resolve browser placement from durable task ownership before live turn state. */
export function browserThreadRoot(
  requested: string | undefined,
  existing: string | undefined,
  triggerContext: SessionRecord["triggerContext"] | undefined,
) {
  if (requested) return requested;
  if (existing) return existing;
  return isJsonString(triggerContext?.threadRootId)
    ? triggerContext.threadRootId
    : undefined;
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

interface ManagedBrowserSession {
  close(): Promise<unknown>;
  clearSavedState(): Promise<unknown>;
  setViewport(width: number, height: number): Promise<unknown>;
}

export class BrowserSessionRegistry<
  Session extends ManagedBrowserSession = AgentBrowserSession,
> {
  private readonly sessions = new Map<string, Session>();
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
    ) => Session,
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
