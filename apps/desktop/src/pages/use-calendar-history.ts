import { useEffect, useState } from "react";

import type { RecurringWorkRecord } from "@chief/agent-runtime/types";

import { useRelaySession } from "../lib/relay-session";

export function useCalendarHistory(work: RecurringWorkRecord[], month: Date) {
  const { client } = useRelaySession();
  const from = new Date(month.getFullYear(), month.getMonth() - 1, 1).getTime();
  const to = new Date(month.getFullYear(), month.getMonth() + 2, 1).getTime();
  const [history, setHistory] = useState<{
    client: typeof client;
    runs: ReadonlyMap<string, readonly number[]>;
  }>({ client: null, runs: new Map() });
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void client.schedules
      .list({ from, to })
      .then((schedules) => {
        if (cancelled) return;
        setHistory((current) => {
          const runs = new Map(current.client === client ? current.runs : []);
          for (const schedule of schedules)
            runs.set(schedule.id, [
              ...new Set([
                ...(runs.get(schedule.id) ?? []),
                ...(work.find((item) => item.id === schedule.id)
                  ?.recordedRuns ?? []),
                ...schedule.recordedRuns,
              ]),
            ]);
          return { client, runs };
        });
      })
      .catch(() => {
        /* Keep already loaded history during a reconnect. */
      });
    return () => {
      cancelled = true;
    };
  }, [client, from, to, work]);
  return work.map((item) => ({
    ...item,
    recordedRuns: [
      ...new Set([
        ...(item.recordedRuns ?? []),
        ...(history.client === client ? (history.runs.get(item.id) ?? []) : []),
      ]),
    ],
  }));
}
