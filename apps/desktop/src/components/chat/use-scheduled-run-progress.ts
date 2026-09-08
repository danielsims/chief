import { useEffect, useState } from "react";
import { z } from "zod";

import type { ChiefUIMessage } from "@chief/agent-runtime/types";
import type { ScheduleRun } from "@chief/relay-contracts";

import { useRelaySession } from "../../lib/relay-session";

/** One request per schedule, shared by the transcript, cards and thread composer. */
export function useScheduledRunProgress(messages: readonly ChiefUIMessage[]) {
  const { client } = useRelaySession();
  const references = JSON.stringify(
    [
      ...new Set(
        messages.flatMap((message) => {
          const run = message.metadata?.scheduledRun;
          return run ? [`${run.scheduleId}\n${run.runId}`] : [];
        }),
      ),
    ].sort(),
  );
  const [snapshot, setSnapshot] = useState<{
    client: typeof client;
    references: string;
    runs: ScheduleRun[];
  }>({ client: null, references: "", runs: [] });
  useEffect(() => {
    if (!client || references === "[]") return;
    const entries = z.array(z.string()).parse(JSON.parse(references));
    const runIds = new Set(entries.map((entry) => entry.split("\n")[1]));
    const ids = [
      ...new Set(
        entries
          .map((entry) => entry.split("\n")[0])
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const lifecycle = new AbortController();
    const isCancelled = () => lifecycle.signal.aborted;
    let fetching = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (isCancelled() || fetching || document.hidden) return;
      fetching = true;
      if (timer) clearTimeout(timer);
      try {
        const runs = (
          await Promise.all(ids.map((id) => client.schedules.runs(id)))
        )
          .flat()
          .filter((run) => runIds.has(run.id));
        if (isCancelled()) return;
        setSnapshot({ client, references, runs });
        if (
          runs.some((run) => run.state === "running" || run.state === "queued")
        )
          timer = setTimeout(() => void refresh(), 3000);
      } catch {
        if (!isCancelled()) {
          // Do not leave an old working indicator spinning through a disconnection.
          setSnapshot({ client, references, runs: [] });
          timer = setTimeout(() => void refresh(), 5000);
        }
      } finally {
        fetching = false;
      }
    };
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    void refresh();
    return () => {
      lifecycle.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [client, references]);
  return snapshot.client === client && snapshot.references === references
    ? snapshot.runs
    : [];
}
