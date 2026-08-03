import type { BrowserRunRecord } from "@chief/agent-runtime/types";

export interface RuntimeBrowserSession {
  runId: string | null;
  url: string;
  streamUrl: string | null;
  conversationId: string;
  parentConversationId: string | null;
  workspaceId: string;
  threadRootId: string | null;
  anchorMessageId: string | null;
  status: "active" | "complete";
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

export function upsertBrowserRun(
  runs: RuntimeBrowserRuns,
  run: BrowserRunRecord,
): RuntimeBrowserRuns {
  const existing = runs.find((candidate) => candidate.id === run.id);
  const next = existing
    ? runs.map((candidate) =>
        candidate.id === run.id ? { ...candidate, ...run } : candidate,
      )
    : [...runs, run];
  return next.sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
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
  return { ...sessions, [session.conversationId]: session };
}

export function updateBrowserSession(
  sessions: RuntimeBrowserSessions,
  conversationId: string,
  update: (session: RuntimeBrowserSession) => RuntimeBrowserSession,
): RuntimeBrowserSessions {
  const session = sessions[conversationId];
  if (!session) return sessions;
  const updated = update(session);
  if (updated === session) return sessions;
  return { ...sessions, [conversationId]: updated };
}

export function anchorBrowserSession(
  sessions: RuntimeBrowserSessions,
  conversationId: string,
  messageId: string,
): RuntimeBrowserSessions {
  return updateBrowserSession(sessions, conversationId, (session) =>
    session.anchorMessageId
      ? session
      : { ...session, anchorMessageId: messageId },
  );
}

export function completeBrowserSession(
  sessions: RuntimeBrowserSessions,
  conversationId: string,
): RuntimeBrowserSessions {
  return updateBrowserSession(sessions, conversationId, (session) => ({
    ...session,
    streamUrl: null,
    status: "complete",
    operatingLabel: null,
    operating: false,
    agentCursor: null,
  }));
}
