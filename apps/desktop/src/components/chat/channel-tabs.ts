import { useEffect, useSyncExternalStore } from "react";
import { z } from "zod";

/** An artifact kept open as a tab in a channel. */
export interface ChannelTab {
  kind: "file" | "database";
  id: string;
}

const tabsSchema = z
  .array(
    z.object({
      kind: z.enum(["file", "database"]),
      id: z.string().min(1).max(160),
    }),
  )
  .max(24);

const changed = "chief:channel-tabs";
const tabsKey = (channelId: string) => `chief.channel-tabs:${channelId}`;
const collapsedKey = "chief.channel-tabs-collapsed";

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Tabs are a convenience; without storage they last until reload.
  }
  window.dispatchEvent(new Event(changed));
}

function subscribe(onChange: () => void) {
  window.addEventListener(changed, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(changed, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function parseTabs(raw: string | null): ChannelTab[] {
  if (!raw) return [];
  try {
    const tabs = tabsSchema.safeParse(JSON.parse(raw));
    return tabs.success ? tabs.data : [];
  } catch {
    return [];
  }
}

const same = (left: ChannelTab, right: ChannelTab) =>
  left.kind === right.kind && left.id === right.id;

/**
 * The artifacts open in a channel's tab bar. A tab stays until it's closed,
 * whichever view is showing, and remembers itself per channel.
 */
export function useChannelTabs(channelId: string, active?: ChannelTab) {
  const key = tabsKey(channelId);
  const raw = useSyncExternalStore(subscribe, () => read(key));
  const collapsed =
    useSyncExternalStore(subscribe, () => read(collapsedKey)) === "1";
  const stored = parseTabs(raw);
  const activeKind = active?.kind;
  const activeId = active?.id;

  // Opening an artifact, from anywhere, keeps it as a tab.
  useEffect(() => {
    if (!activeKind || !activeId) return;
    const tab = { kind: activeKind, id: activeId };
    const current = parseTabs(read(key));
    if (!current.some((other) => same(other, tab)))
      write(key, JSON.stringify([...current, tab].slice(-24)));
  }, [activeId, activeKind, key]);

  const tabs =
    active && !stored.some((tab) => same(tab, active))
      ? [...stored, active]
      : stored;

  return {
    tabs,
    collapsed,
    setCollapsed: (next: boolean) => write(collapsedKey, next ? "1" : null),
    close: (tab: ChannelTab) =>
      write(
        key,
        JSON.stringify(
          parseTabs(read(key)).filter((other) => !same(other, tab)),
        ),
      ),
  };
}
