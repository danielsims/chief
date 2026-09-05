import { useEffect, useState } from "react";
import { ArrowUpRight, FlaskConical, Pause, Play, Target } from "lucide-react";

import type { Mission } from "@chief/relay-contracts";
import { missionBestValue } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";

import { useRelaySession } from "../../lib/relay-session";
import { StreamingMarkdown } from "./streaming-markdown";

export function MissionCanvas({ conversationId }: { conversationId: string }) {
  const { client } = useRelaySession();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await client.listMissions();
        if (!cancelled) {
          setMissions(
            next.filter((item) => item.conversationId === conversationId),
          );
          setError(null);
        }
      } catch (cause) {
        if (!cancelled)
          setError(
            cause instanceof Error ? cause.message : "Could not load missions.",
          );
      }
    };
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [client, conversationId]);

  const changeStatus = async (mission: Mission, status: Mission["status"]) => {
    if (!client) return;
    setBusy(mission.id);
    try {
      const updated = await client.updateMissionStatus(
        mission.id,
        status,
        `Workspace owner ${status === "paused" ? "paused" : "resumed"} this mission from its Canvas.`,
      );
      setMissions((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update mission.",
      );
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="space-y-4" aria-label="Channel missions">
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {missions.length === 0 ? (
        <div className="bg-muted/25 rounded-xl border border-dashed p-6">
          <Target className="text-muted-foreground mb-3 size-5" />
          <h3 className="text-sm font-medium">Give this channel an outcome</h3>
          <p className="text-muted-foreground mt-2 max-w-lg text-sm leading-6">
            Ask Chief to turn your goal into a mission. The team, progress,
            experiments and evidence will stay here alongside the work.
          </p>
        </div>
      ) : (
        missions.map((mission) => (
          <MissionCard
            key={mission.id}
            mission={mission}
            busy={busy === mission.id}
            onStatusChange={(status) => void changeStatus(mission, status)}
          />
        ))
      )}
    </section>
  );
}

export function MissionCard({
  mission,
  busy = false,
  onStatusChange,
}: {
  mission: Mission;
  busy?: boolean;
  onStatusChange?: (status: Mission["status"]) => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const metric = mission.success.kind === "metric" ? mission.success : null;
  const best = missionBestValue(mission);
  const expired = Date.parse(mission.deadline) <= now;
  const remaining = mission.maxExperiments - mission.experiments.length;
  const progress =
    metric && best !== null
      ? Math.max(
          0,
          Math.min(
            100,
            ((best - metric.baseline) / (metric.target - metric.baseline)) *
              100,
          ),
        )
      : null;
  const status =
    mission.status === "active" && expired
      ? "Deadline reached"
      : mission.status;
  return (
    <article className="bg-background overflow-hidden rounded-xl border shadow-sm">
      <div className="space-y-5 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-muted-foreground mb-2 flex items-center gap-2 text-xs">
              <Target className="size-3.5" /> MISSION{" "}
              <span className="bg-muted rounded-full px-2 py-0.5 capitalize">
                {status}
              </span>
            </div>
            <h3 className="text-lg font-semibold tracking-tight">
              {mission.title}
            </h3>
            <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
              {mission.objective}
            </p>
          </div>
          {onStatusChange && mission.status !== "completed" && (
            <Button
              variant="outline"
              size="sm"
              disabled={
                busy ||
                (mission.status === "paused" && (expired || remaining <= 0))
              }
              onClick={() =>
                onStatusChange(
                  mission.status === "active" ? "paused" : "active",
                )
              }
            >
              {mission.status === "active" ? (
                <Pause className="size-3.5" />
              ) : (
                <Play className="size-3.5" />
              )}
              {mission.status === "active" ? "Pause" : "Resume"}
            </Button>
          )}
        </div>
        {metric ? (
          <div className="bg-muted/30 rounded-lg p-4">
            <div className="mb-3 flex items-center justify-between text-xs">
              <span>{metric.name}</span>
              <span className="text-muted-foreground">
                {metric.direction === "increase" ? "Higher" : "Lower"} is better
              </span>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Baseline", value: metric.baseline },
                { label: "Best measured", value: best },
                { label: "Target", value: metric.target },
              ].map(({ label, value }) => (
                <div key={label}>
                  <div className="text-2xl font-medium tabular-nums">
                    {value?.toLocaleString()}
                    <span className="text-muted-foreground ml-1 text-xs">
                      {metric.unit}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-1 text-xs">
                    {label}
                  </div>
                </div>
              ))}
            </div>
            <div
              className="bg-muted mt-4 h-1.5 overflow-hidden rounded-full"
              role="progressbar"
              aria-label="Progress toward mission target"
              aria-valuenow={progress ?? 0}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="bg-foreground h-full rounded-full transition-all"
                style={{ width: `${progress ?? 0}%` }}
              />
            </div>
            <div className="text-muted-foreground mt-3 text-xs leading-5">
              Source: {metric.source}
              <br />
              Evaluation: {metric.evaluationWindow}
            </div>
          </div>
        ) : (
          <p className="border-l-2 pl-3 text-sm leading-6">
            {mission.success.kind === "deliverable" &&
              mission.success.description}
          </p>
        )}
        <div className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-2 text-xs">
          <span>Owner · {mission.ownerAgentId}</span>
          {mission.collaborators.length > 0 && (
            <span>Team · {mission.collaborators.join(", ")}</span>
          )}
          <span>
            Due ·{" "}
            {new Date(mission.deadline).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
          <span>
            {mission.experiments.length} / {mission.maxExperiments} experiments
          </span>
        </div>
        <details className="text-muted-foreground text-xs">
          <summary className="cursor-pointer">
            Boundaries &amp; decisions
          </summary>
          <p className="mt-2 leading-5 whitespace-pre-wrap">
            {mission.constraints}
          </p>
          {mission.statusEvidence && (
            <p className="mt-2 leading-5">{mission.statusEvidence}</p>
          )}
        </details>
      </div>
      {mission.experiments.length > 0 && (
        <div className="border-t px-6 py-4">
          <h4 className="mb-3 flex items-center gap-2 text-xs font-medium">
            <FlaskConical className="size-3.5" /> Experiment history
          </h4>
          <div className="space-y-3">
            {mission.experiments
              .slice()
              .reverse()
              .map((experiment, index) => (
                <details
                  key={experiment.id}
                  className="group rounded-lg border p-3"
                  open={index === 0}
                >
                  <summary className="flex cursor-pointer items-start justify-between gap-3 text-sm">
                    <span>{experiment.hypothesis}</span>
                    <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs capitalize">
                      {experiment.decision === "keep" && (
                        <ArrowUpRight className="size-3" />
                      )}
                      {experiment.decision}
                      {experiment.value !== null &&
                        ` · ${experiment.value.toLocaleString()}`}
                    </span>
                  </summary>
                  <div className="text-muted-foreground mt-3 space-y-2 text-sm leading-6">
                    <p>{experiment.change}</p>
                    <StreamingMarkdown>{experiment.evidence}</StreamingMarkdown>
                  </div>
                </details>
              ))}
          </div>
        </div>
      )}
    </article>
  );
}
