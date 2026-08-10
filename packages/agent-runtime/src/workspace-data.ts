import type { LocalStore } from "./local-store.js";
import type { SessionRecord } from "./types.js";
import { runDateKey, upcomingRuns } from "./recurring-work.js";

export const INITIAL_REVIEW_SINGLETON_AGENTS = new Set([
  "brand",
  "prospector",
  "setup",
]);

function sessionRank(status: SessionRecord["status"]) {
  return status === "completed"
    ? 4
    : status === "running" || status === "waiting"
      ? 3
      : status === "idle"
        ? 2
        : 1;
}

export function preferredSession<
  T extends Pick<SessionRecord, "status" | "updatedAt">,
>(current: T | undefined, candidate: T) {
  if (!current) return candidate;
  const currentRank = sessionRank(current.status);
  const candidateRank = sessionRank(candidate.status);
  return candidateRank > currentRank ||
    (candidateRank === currentRank && candidate.updatedAt > current.updatedAt)
    ? candidate
    : current;
}
export async function workspaceData(store: LocalStore, workspaceId: string) {
  const [
    prospects,
    trends,
    analyticsDatasets,
    drafts,
    campaigns,
    recurringWork,
    activity,
    actionItems,
  ] = await Promise.all([
    store.listProspects(workspaceId),
    store.listTrends(workspaceId),
    store.listAnalyticsDatasets(workspaceId),
    store.listDrafts(workspaceId),
    store.listCampaigns(workspaceId),
    store.listRecurringWork(workspaceId),
    store.listActivitySessions(workspaceId),
    store.listActionItems(workspaceId),
  ]);
  const initialReviewIds = new Set(
    activity
      .filter(
        (session) =>
          !session.parentId &&
          (session.id.startsWith("workspace-kickoff-") ||
            session.title === "Initial business review"),
      )
      .map((session) => session.id),
  );
  const initialSingletonSessions = new Map<string, SessionRecord>();
  const visibleActivity = activity.filter((session) => {
    if (
      !INITIAL_REVIEW_SINGLETON_AGENTS.has(session.agent) ||
      !session.parentId ||
      (!session.parentId.startsWith("workspace-kickoff-") &&
        !initialReviewIds.has(session.parentId)) ||
      session.scheduleId
    ) {
      return true;
    }
    const key = `${session.parentId}\0${session.agent}`;
    const current = initialSingletonSessions.get(key);
    initialSingletonSessions.set(key, preferredSession(current, session));
    return false;
  });
  visibleActivity.push(...initialSingletonSessions.values());
  return {
    prospects,
    trends,
    analyticsDatasets,
    drafts,
    campaigns,
    activity: visibleActivity,
    actionItems,
    recurringWork: recurringWork.map((work) => {
      try {
        const skipped = new Set(work.skipDates ?? []);
        const persisted = work.nextAt;
        const projected =
          work.onceAt !== undefined
            ? []
            : upcomingRuns(work.cron, work.timezone).filter(
                (timestamp) =>
                  !skipped.has(runDateKey(timestamp, work.timezone)) &&
                  (persisted === undefined || timestamp > persisted),
              );
        return {
          ...work,
          upcomingRuns: [
            ...(persisted === undefined ? [] : [persisted]),
            ...projected,
          ],
        };
      } catch {
        return {
          ...work,
          upcomingRuns: work.nextAt === undefined ? [] : [work.nextAt],
        };
      }
    }),
  };
}
