import { useCallback, useEffect, useSyncExternalStore } from "react";

import type { RelayClient } from "@chief/relay-client";
import type { WorkspaceSchedule } from "@chief/relay-contracts";

import { useRelaySession } from "./relay-session-context";

/**
 * Automations as cards in conversations see them. A card points at an
 * automation by id, so every card for it, and the page it opens, share one
 * record here: a save or approval on one card shows on all of them at once.
 * One list request serves every card on screen; it is read when a card
 * appears, when the window regains focus, and after each change, never on a
 * timer.
 */
type Entry = WorkspaceSchedule | "missing";

const records = new Map<string, Entry>();
const listeners = new Set<() => void>();
let loading: Promise<void> | undefined;
let loadedAt = 0;

const FRESH_FOR_MS = 5_000;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reads every automation once, shared by all cards asking at the same time. */
export function loadAutomationRecords(client: RelayClient, force = false) {
  if (loading) return loading;
  if (!force && Date.now() - loadedAt < FRESH_FOR_MS) return Promise.resolve();
  loading = client.schedules
    .list()
    .then((schedules) => {
      const seen = new Set<string>();
      for (const schedule of schedules) {
        records.set(schedule.id, schedule);
        seen.add(schedule.id);
      }
      for (const id of records.keys())
        if (!seen.has(id)) records.set(id, "missing");
      loadedAt = Date.now();
      emit();
    })
    .finally(() => {
      loading = undefined;
    });
  return loading;
}

/** Takes a record the relay just returned, so every card shows it at once. */
export function adoptAutomationRecord(schedule: WorkspaceSchedule) {
  records.set(schedule.id, schedule);
  emit();
}

export function forgetAutomationRecord(id: string) {
  records.set(id, "missing");
  emit();
}

export function useAutomationRecord(id: string) {
  const { client } = useRelaySession();
  const entry = useSyncExternalStore(subscribe, () => records.get(id));
  const refresh = useCallback(
    (force = true) =>
      client ? loadAutomationRecords(client, force) : Promise.resolve(),
    [client],
  );
  useEffect(() => {
    if (!client) return;
    // An automation this window hasn't seen, such as one an agent just
    // proposed, is worth a fresh read.
    const known = records.get(id);
    void loadAutomationRecords(client, !known || known === "missing").catch(
      () => undefined,
    );
    const onFocus = () =>
      void loadAutomationRecords(client).catch(() => undefined);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [client, id]);
  return {
    record: entry === "missing" ? null : entry,
    /** Undefined until the first read; null once known to be gone. */
    state:
      entry === undefined
        ? "loading"
        : entry === "missing"
          ? "missing"
          : "ready",
    refresh,
  } as const;
}
