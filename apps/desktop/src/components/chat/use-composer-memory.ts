import { useEffect, useRef } from "react";
import { z } from "zod";

const MAX_HISTORY = 50;

function read(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable; the composer still works without memory.
  }
}

const historySchema = z.array(z.string());

function readHistory(key: string): string[] {
  try {
    const parsed = historySchema.safeParse(JSON.parse(read(key) ?? "[]"));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/**
 * Keeps a composer's unsent draft across reloads and remembers what was sent
 * from it, so Arrow Up can bring a previous prompt back. Each storage key is
 * one place, such as a conversation or one of its threads.
 */
export function useComposerMemory({
  storageKey,
  value,
  onValueChange,
}: {
  storageKey: string | undefined;
  value: string;
  onValueChange: (value: string) => void;
}) {
  const draftKey = storageKey ? `chief:composer-draft:${storageKey}` : null;
  const historyKey = storageKey ? `chief:composer-history:${storageKey}` : null;
  const restoredKey = useRef<string | null>(null);
  const browsing = useRef<{ index: number; stash: string } | null>(null);

  // Load this place's draft when it opens. The first load keeps any text the
  // caller already supplied; switching places replaces it.
  useEffect(() => {
    if (!draftKey || restoredKey.current === draftKey) return;
    const firstLoad = restoredKey.current === null;
    restoredKey.current = draftKey;
    browsing.current = null;
    const stored = read(draftKey);
    if (stored) onValueChange(stored);
    else if (!firstLoad) onValueChange("");
  }, [draftKey, onValueChange]);

  useEffect(() => {
    if (!draftKey || restoredKey.current !== draftKey) return;
    write(draftKey, value.trim() ? value : null);
  }, [draftKey, value]);

  return {
    remember(text: string) {
      browsing.current = null;
      const trimmed = text.trim();
      if (!historyKey || !trimmed) return;
      const history = readHistory(historyKey).filter(
        (item) => item !== trimmed,
      );
      write(
        historyKey,
        JSON.stringify([...history, trimmed].slice(-MAX_HISTORY)),
      );
    },
    /** The prompt to show after stepping back (-1) or forward (+1), or
     * undefined when there is nothing further that way. */
    step(direction: -1 | 1): string | undefined {
      if (!historyKey) return undefined;
      const history = readHistory(historyKey);
      const current = browsing.current ?? {
        index: history.length,
        stash: value,
      };
      const index = current.index + direction;
      if (index < 0 || index > history.length) return undefined;
      browsing.current =
        index === history.length ? null : { ...current, index };
      return index === history.length ? current.stash : history[index];
    },
  };
}
