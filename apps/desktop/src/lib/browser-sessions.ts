import type {
  BrowserPresentationMode,
  BrowserRunRecord,
} from "@chief/agent-runtime/types";
import type { JsonValue } from "@chief/relay-contracts";
import { isJsonObject, isJsonString } from "@chief/relay-contracts";

export interface RuntimeBrowserSession {
  runId: string;
  url: string;
  streamUrl: string | null;
  conversationId: string;
  parentConversationId: string | null;
  workspaceId: string;
  threadRootId: string | null;
  anchorMessageId: string | null;
  status: "active" | "complete";
  createdAt: number;
  presentation: BrowserPresentationMode;
  presentationRevision: number;
  operatingLabel: string | null;
  operating: boolean;
  agentCursor: {
    x: number;
    y: number;
    visible: boolean;
    label?: string;
    pressed?: boolean;
    typing?: boolean;
  } | null;
}

export type RuntimeBrowserSessions = Readonly<
  Record<string, RuntimeBrowserSession>
>;

export type RuntimeBrowserRuns = readonly BrowserRunRecord[];

/** A child-owned run projects into its parent chat even during live repair. */
export function browserRunBelongsToChat(
  run: BrowserRunRecord,
  chatId: string,
  childSessionIds: ReadonlySet<string>,
) {
  return (
    run.conversationId === chatId ||
    run.parentConversationId === chatId ||
    childSessionIds.has(run.conversationId)
  );
}

/** Prefer the visible thread root owned by the browser's child session. */
export function projectBrowserRunToOwnedThread(
  run: BrowserRunRecord,
  threadRootId: string | null,
  childSessionIds: ReadonlySet<string>,
) {
  if (!threadRootId || !childSessionIds.has(run.conversationId)) return run;
  return { ...run, threadRootId };
}

export interface BrowserOwnerCandidate {
  id: string;
  role: string;
  threadRootId: string | null;
  isBrowserOpen: boolean;
}

/**
 * True when a tool result is a successful `browserOpen` payload. The executor
 * surfaces the browser as a generic `executor_execute` call whose persisted
 * input is often empty, so the result body — `{ opened: true, url: ... }` — is
 * the reliable open signal. Snapshot/click/fill results do not contain it.
 */
export function browserOpenResultContent(
  content: JsonValue | undefined,
): boolean {
  const text = isJsonString(content)
    ? content
    : Array.isArray(content)
      ? content
          .map((block) =>
            block &&
            isJsonObject(block) &&
            "text" in block &&
            isJsonString(block.text)
              ? block.text
              : "",
          )
          .join("\n")
      : content && isJsonObject(content)
        ? JSON.stringify(content)
        : "";
  return (
    /\bopened\s*["']?\s*:\s*true\b/i.test(text) &&
    /["']?url["']?\s*:/i.test(text)
  );
}

/**
 * Resolve the assistant message that owns an embedded browser session.
 *
 * The browser renders inline at the message whose tool call opened it, exactly
 * where that message sits in the conversation — a thread reply stays in the
 * thread, a channel message stays in the main timeline. Scanning for the first
 * browser-open call in the whole conversation is ambiguous: an older
 * browser-open in the main timeline can steal the viewer from the thread reply
 * that actually opened the current session. Match the session's thread
 * placement first, then the newest candidate, so live and restored transcripts
 * agree on the same owner.
 */
export function resolveBrowserOwnerMessageId(
  candidates: readonly BrowserOwnerCandidate[],
  threadRootId: string | null,
  anchorMessageId?: string,
): string | undefined {
  if (
    anchorMessageId &&
    candidates.some((candidate) => candidate.id === anchorMessageId)
  ) {
    return anchorMessageId;
  }
  const openers = candidates.filter(
    (candidate) => candidate.isBrowserOpen && candidate.role === "assistant",
  );
  if (openers.length === 0) return undefined;
  const threadMatches = openers.filter(
    (candidate) => (candidate.threadRootId ?? null) === threadRootId,
  );
  const pool = threadMatches.length > 0 ? threadMatches : openers;
  return pool.at(-1)?.id;
}

export function upsertBrowserRun(
  runs: RuntimeBrowserRuns,
  run: BrowserRunRecord,
): RuntimeBrowserRuns {
  const existing = runs.find((candidate) => candidate.id === run.id);
  const durableThreadRootId = existing?.threadRootId ?? run.threadRootId;
  const next = existing
    ? runs.map((candidate) =>
        candidate.id === run.id
          ? {
              ...candidate,
              ...run,
              conversationId: candidate.threadRootId
                ? candidate.conversationId
                : run.threadRootId
                  ? run.conversationId
                  : candidate.conversationId,
              parentConversationId:
                candidate.parentConversationId ?? run.parentConversationId,
              ...(durableThreadRootId
                ? { threadRootId: durableThreadRootId }
                : undefined),
              ...(candidate.anchorMessageId
                ? { anchorMessageId: candidate.anchorMessageId }
                : undefined),
              createdAt: candidate.createdAt,
            }
          : candidate,
      )
    : [...runs, run];
  return next.sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
}

/** Reconciles a server snapshot without letting aliases move mounted viewers. */
export function mergeBrowserRunSnapshot(
  current: RuntimeBrowserRuns,
  incoming: RuntimeBrowserRuns,
) {
  const incomingIds = new Set(incoming.map((run) => run.id));
  return incoming
    .reduce<RuntimeBrowserRuns>(upsertBrowserRun, current)
    .filter((run) => incomingIds.has(run.id));
}

export function completeBrowserRun(
  runs: RuntimeBrowserRuns,
  id: string,
): RuntimeBrowserRuns {
  return runs.map((run) =>
    run.id === id ? { ...run, status: "complete", updatedAt: Date.now() } : run,
  );
}

export function anchorBrowserRun(
  runs: RuntimeBrowserRuns,
  id: string,
  messageId: string,
): RuntimeBrowserRuns {
  return runs.map((run) =>
    run.id === id
      ? { ...run, anchorMessageId: messageId, updatedAt: Date.now() }
      : run,
  );
}

export interface RuntimeBrowserActivity {
  label: string;
  cursor?: {
    x: number;
    y: number;
    pressed?: boolean;
    typing?: boolean;
    visible?: boolean;
  };
}

/** Move the persistent cursor while preserving it across non-pointing actions. */
export function beginBrowserActivity(
  session: RuntimeBrowserSession,
  activity: RuntimeBrowserActivity,
): RuntimeBrowserSession {
  return {
    ...session,
    operatingLabel: activity.label,
    operating: true,
    agentCursor: activity.cursor
      ? {
          ...activity.cursor,
          visible: activity.cursor.visible ?? true,
          label: "Chief",
          pressed: activity.cursor.pressed ?? false,
          typing: activity.cursor.typing ?? false,
        }
      : session.agentCursor,
  };
}

/** Settle the cursor at the last target after the browser action completes. */
export function completeBrowserActivity(
  session: RuntimeBrowserSession,
  activity: RuntimeBrowserActivity,
): RuntimeBrowserSession {
  return {
    ...session,
    operatingLabel: activity.label,
    operating: false,
    agentCursor: activity.cursor
      ? {
          ...activity.cursor,
          visible: activity.cursor.visible ?? true,
          label: "Chief",
          pressed: activity.cursor.pressed ?? false,
          typing: activity.cursor.typing ?? false,
        }
      : session.agentCursor,
  };
}

export function hideBrowserCursor(
  session: RuntimeBrowserSession,
): RuntimeBrowserSession {
  return session.agentCursor?.visible
    ? {
        ...session,
        agentCursor: {
          ...session.agentCursor,
          visible: false,
          pressed: false,
          typing: false,
        },
      }
    : session;
}

export function upsertBrowserSession(
  sessions: RuntimeBrowserSessions,
  session: RuntimeBrowserSession,
): RuntimeBrowserSessions {
  const existing = sessions[session.runId];
  if (!existing) return { ...sessions, [session.runId]: session };
  const threadRootId = existing.threadRootId ?? session.threadRootId;
  return {
    ...sessions,
    [session.runId]: {
      ...session,
      conversationId: existing.threadRootId
        ? existing.conversationId
        : session.threadRootId
          ? session.conversationId
          : existing.conversationId,
      parentConversationId:
        existing.parentConversationId ?? session.parentConversationId,
      threadRootId,
      anchorMessageId: existing.anchorMessageId ?? session.anchorMessageId,
      createdAt: existing.createdAt,
    },
  };
}

export function updateBrowserSession(
  sessions: RuntimeBrowserSessions,
  runId: string,
  update: (session: RuntimeBrowserSession) => RuntimeBrowserSession,
): RuntimeBrowserSessions {
  const session = sessions[runId];
  if (!session) return sessions;
  const updated = update(session);
  if (updated === session) return sessions;
  return { ...sessions, [runId]: updated };
}

export function anchorBrowserSession(
  sessions: RuntimeBrowserSessions,
  runId: string,
  messageId: string,
): RuntimeBrowserSessions {
  return updateBrowserSession(sessions, runId, (session) =>
    session.anchorMessageId
      ? session
      : { ...session, anchorMessageId: messageId },
  );
}

export function completeBrowserSession(
  sessions: RuntimeBrowserSessions,
  runId: string,
): RuntimeBrowserSessions {
  return updateBrowserSession(sessions, runId, (session) => ({
    ...session,
    streamUrl: null,
    status: "complete",
    operatingLabel: null,
    operating: false,
    agentCursor: null,
  }));
}

export function presentBrowserSession(
  sessions: RuntimeBrowserSessions,
  runId: string,
  presentation: BrowserPresentationMode,
): RuntimeBrowserSessions {
  return updateBrowserSession(sessions, runId, (session) => ({
    ...session,
    presentation,
    presentationRevision: session.presentationRevision + 1,
  }));
}
