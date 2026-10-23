import { useCallback, useEffect, useState } from "react";

import type { RelayClient } from "@chief/relay-client";
import type { ScheduleRun, WorkspaceSchedule } from "@chief/relay-contracts";

const activeStates = new Set<ScheduleRun["state"]>(["queued", "running"]);

/**
 * The latest runs of an automation, and its test. An automation with steps
 * has to pass a test of its current version before it can be turned on.
 */
export function useAutomationRuns(
  client: RelayClient | null | undefined,
  schedule: WorkspaceSchedule | null,
) {
  const [runs, setRuns] = useState<ScheduleRun[]>([]);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);
  const sorted = [...runs].sort(
    (left, right) => right.createdAt - left.createdAt,
  );
  const latest = sorted[0];
  const latestTest = sorted.find((run) => run.test);
  const testing = Boolean(latestTest && activeStates.has(latestTest.state));
  const testPassed = Boolean(
    schedule &&
    latestTest?.state === "completed" &&
    latestTest.schedule.updatedAt === schedule.updatedAt,
  );

  const scheduleId = schedule?.id;
  const live = schedule?.status === "active" || testing;
  useEffect(() => {
    if (!client || !scheduleId) return;
    let active = true;
    const load = () =>
      void client.schedules
        .runs(scheduleId)
        .then((next) => {
          if (active) setRuns(next);
        })
        .catch(() => undefined);
    load();
    if (!live) return () => void (active = false);
    const timer = window.setInterval(load, testing ? 3_000 : 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [client, scheduleId, live, testing, tick]);

  return {
    latest,
    testing,
    testPassed,
    nodes: latest?.automation?.nodes ?? {},
    /** The latest run got past its trigger. */
    triggered: Boolean(latest && latest.state !== "queued"),
    refresh,
  };
}
