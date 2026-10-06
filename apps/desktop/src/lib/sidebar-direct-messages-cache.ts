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

export function readSidebarDirectMessagesCache(
  workspaceId: string | null,
): SidebarDirectMessagesCache {
  if (!workspaceId) return EMPTY;
  try {
    const parsed = sidebarDirectMessagesCacheSchema.safeParse(
      JSON.parse(
        window.localStorage.getItem(storageKey(workspaceId)) ?? "null",
      ),
    );
    return parsed.success ? parsed.data : EMPTY;
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
