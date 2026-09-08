import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Link } from "react-router";

import type { ScheduleRun } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";

import { useRelaySession } from "../lib/relay-session";

export function ScheduleRunHistory({ scheduleId }: { scheduleId: string }) {
  const { client } = useRelaySession();
  const [runs, setRuns] = useState<ScheduleRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let inFlight = false;
    const refresh = async () => {
      if (!client || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const next = await client.schedules.runs(scheduleId);
        if (active) {
          setRuns(next);
          setError("");
        }
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "Could not load runs.",
          );
      } finally {
        inFlight = false;
        if (active) setLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [client, scheduleId]);
  const act = async (run: ScheduleRun, action: "cancel" | "retry") => {
    if (!client || busy) return;
    setBusy(run.id);
    try {
      await client.schedules.runAction(scheduleId, run.id, action);
      setRuns(await client.schedules.runs(scheduleId));
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update this run.",
      );
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="border-border/60 mt-4 border-t pt-4">
      <h3 className="text-muted-foreground text-xs">Recent runs</h3>
      {error ? (
        <p role="alert" className="text-destructive mt-2 text-xs">
          {error}
        </p>
      ) : null}
      {runs.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-xs">
          {loading ? "Loading…" : "No runs yet."}
        </p>
      ) : (
        <div className="divide-border/60 mt-2 max-h-56 divide-y overflow-y-auto">
          {runs.slice(0, 20).map((run) => (
            <details key={run.id} className="group py-2.5 text-xs">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                <span>
                  {new Date(run.createdAt).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  <span className="text-muted-foreground ml-2">
                    {run.source === "cron"
                      ? "Scheduled"
                      : run.source === "webhook"
                        ? "Webhook"
                        : run.source === "retry"
                          ? "Retry"
                          : "Manual"}
                  </span>
                </span>
                <span
                  className={
                    run.state === "failed" || run.state === "blocked"
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }
                >
                  {run.state === "cancelled"
                    ? "Stopped"
                    : run.state.charAt(0).toUpperCase() + run.state.slice(1)}
                </span>
                <ChevronDown
                  size={12}
                  className="text-muted-foreground shrink-0 transition-transform group-open:rotate-180"
                />
              </summary>
              {run.summary ? (
                <p className="text-foreground/80 mt-3 leading-5 whitespace-pre-wrap">
                  {run.summary}
                </p>
              ) : null}
              <ol className="my-3 space-y-2">
                {run.steps.map((step) => (
                  <li key={step.id}>
                    <div className="flex justify-between gap-3">
                      <span>
                        {step.agentId} ·{" "}
                        {step.phase === "plan"
                          ? "Plan"
                          : step.phase === "contribute"
                            ? "Contribution"
                            : "Result"}
                      </span>
                      <span className="text-muted-foreground">
                        {step.state}
                      </span>
                    </div>
                    {step.evidence || step.error ? (
                      <p className="text-muted-foreground mt-1 leading-5 whitespace-pre-wrap">
                        {step.evidence ?? step.error}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
              <div className="flex items-center justify-between">
                <Link
                  className="underline underline-offset-4"
                  to={`/conversations?${new URLSearchParams({ channel: run.schedule.conversationId, thread: run.threadRootId })}`}
                >
                  Open thread
                </Link>
                {run.state === "running" || run.state === "queued" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => void act(run, "cancel")}
                  >
                    {busy === run.id ? "Stopping…" : "Stop run"}
                  </Button>
                ) : ["failed", "blocked", "cancelled"].includes(run.state) ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => void act(run, "retry")}
                  >
                    {busy === run.id ? "Starting…" : "Retry"}
                  </Button>
                ) : null}
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
