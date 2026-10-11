import { z } from "zod";

/**
 * The DM sidebar as it was last shown, so the next launch paints the same
 * rows in the same order before channels, members and history reload.
 */
const sidebarDirectMessagesCacheSchema = z.object({
  people: z.array(
    z.object({
      channelId: z.string(),
      name: z.string(),
      image: z.string().optional(),
    }),
  ),
  /** Latest message time (ms) per entry key: `agent:<id>` or `channel:<id>`. */
  lastMessageAt: z.record(z.string(), z.number()),
});

export type SidebarDirectMessagesCache = z.infer<
  typeof sidebarDirectMessagesCacheSchema
>;

const EMPTY: SidebarDirectMessagesCache = { people: [], lastMessageAt: {} };

function storageKey(workspaceId: string) {
  return `chief:sidebar-direct-messages:v1:${workspaceId}`;
}

export function parseSidebarDirectMessagesCache(
  json: string | null,
): SidebarDirectMessagesCache {
  try {
    const parsed = sidebarDirectMessagesCacheSchema.safeParse(
      JSON.parse(json ?? "null"),
    );
    return parsed.success ? parsed.data : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function readSidebarDirectMessagesCache(
  workspaceId: string | null,
): SidebarDirectMessagesCache {
  if (!workspaceId) return EMPTY;
  try {
    return parseSidebarDirectMessagesCache(
      window.localStorage.getItem(storageKey(workspaceId)),
    );
  } catch {
    return EMPTY;
  }
}

/** Takes the cache already serialized, so callers can compare it cheaply. */
export function writeSidebarDirectMessagesCache(
  workspaceId: string | null,
  cache: string,
) {
  if (!workspaceId) return;
  try {
    window.localStorage.setItem(storageKey(workspaceId), cache);
  } catch {
    // Storage can be full or unavailable; the sidebar still renders live data.
  }
}

/**
 * Newest message first. Each entry is ranked by the later of its live time
 * and the time remembered from an earlier render, so history that is still
 * reloading (or briefly missing) never drops a row down the list. Entries
 * with no messages keep their input order.
 */
export function orderSidebarDirectMessages<
  Entry extends { key: string; live: number },
>(entries: readonly Entry[], rememberedAt: Readonly<Record<string, number>>) {
  return entries
    .map((entry, index) => ({
      ...entry,
      at: Math.max(entry.live, rememberedAt[entry.key] ?? 0),
      index,
    }))
    .sort((a, b) => b.at - a.at || a.index - b.index);
}
