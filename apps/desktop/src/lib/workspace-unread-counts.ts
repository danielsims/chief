import { useEffect, useMemo } from "react";

import { isJsonNumber } from "@chief/relay-contracts";

import { syncDesktopUnreadBadge } from "./notifications";

const KEY_PREFIX = "chief:workspace-unread-counts:v1:";

export function readWorkspaceUnreadCounts(readerId: string) {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(`${KEY_PREFIX}${readerId}`) ?? "{}",
    ) as Record<string, unknown>;
    return new Map(
      Object.entries(parsed).flatMap(([workspaceId, value]) =>
        isJsonNumber(value) && value > 0
          ? ([[workspaceId, value]] as const)
          : [],
      ),
    );
  } catch {
    return new Map<string, number>();
  }
}

export function writeWorkspaceUnreadCounts(
  readerId: string,
  counts: ReadonlyMap<string, number>,
) {
  window.localStorage.setItem(
    `${KEY_PREFIX}${readerId}`,
    JSON.stringify(Object.fromEntries(counts)),
  );
}

export function useWorkspaceUnreadCounts(
  readerId: string,
  workspaceId: string,
  totalUnread: number,
) {
  const counts = useMemo(() => {
    const next = readWorkspaceUnreadCounts(readerId);
    if (totalUnread > 0) next.set(workspaceId, totalUnread);
    else next.delete(workspaceId);
    return next;
  }, [readerId, totalUnread, workspaceId]);
  useEffect(() => {
    void syncDesktopUnreadBadge(totalUnread);
    writeWorkspaceUnreadCounts(readerId, counts);
  }, [counts, readerId, totalUnread]);
  return counts;
}
