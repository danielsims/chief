import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  ExternalLink,
  LoaderCircle,
  X,
} from "lucide-react";

import type {
  EveAgentProvisioningPhase,
  EveAgentProvisioningProgress,
  EveAgentProvisioningResult,
  EveDeploymentLogLine,
  VercelDeploymentReadyState,
} from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";

export type EveConnectionPhase = EveAgentProvisioningPhase | "verifying";

const steps: readonly {
  phases: readonly EveConnectionPhase[];
  label: string;
}[] = [
  { phases: ["validating", "uploading"], label: "Prepare the Eve agent" },
  {
    phases: ["deploying", "configuring", "waiting"],
    label: "Deploy to Vercel",
  },
  {
    phases: ["checking", "verifying"],
    label: "Connect messaging with Chief",
  },
];

const readyStateLabel: Record<VercelDeploymentReadyState, string> = {
  QUEUED: "Queued",
  INITIALIZING: "Initializing",
  BUILDING: "Building",
  READY: "Ready",
  ERROR: "Failed",
  CANCELED: "Canceled",
};

export function formatBuildDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

export const VERCEL_BUILD_LOG_BODY_CLASS = "h-52 overflow-y-auto";

export function collapsedBuildLogSummary({
  complete,
  failed,
  logs,
}: {
  complete: boolean;
  failed: boolean;
  logs: readonly EveDeploymentLogLine[];
}) {
  if (failed) return latestBuildLogText(logs) ?? "Build failed";
  if (complete) return "Deployed successfully";
  return latestBuildLogText(logs) ?? "No output yet";
}

function latestBuildLogText(logs: readonly EveDeploymentLogLine[]) {
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const line = logs[index];
    if (!line) continue;
    const text = line.text.trim();
    if (!text) continue;
    return line.source === "command" ? `▸ ${text}` : text;
  }
  return undefined;
}

export function formatLogTimestamp(at?: number) {
  if (!at) return "";
  const date = new Date(at < 10_000_000_000 ? at * 1000 : at);
  if (Number.isNaN(date.getTime())) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const millis = String(date.getMilliseconds()).padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${millis}`;
}

export function EveProvisioningStatus({
  agentName,
  workspaceName,
  phase,
  progress,
  result,
  complete = false,
  error,
}: {
  agentName: string;
  workspaceName: string;
  phase: EveConnectionPhase;
  progress: EveAgentProvisioningProgress | null;
  result?: EveAgentProvisioningResult | null;
  complete?: boolean;
  error?: string | null;
}) {
  const activeIndex = steps.findIndex((step) => step.phases.includes(phase));
  const inspectorUrl = result?.inspectorUrl ?? progress?.inspectorUrl;
  const finished = Boolean(result) || complete;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[15px] font-medium">{agentName}</p>
        <p className="text-muted-foreground mt-1 text-sm leading-5">
          Deploying to Vercel Eve
          {workspaceName ? ` for ${workspaceName}` : ""}.
        </p>
      </div>
      <div className="min-h-[24px]">
        {inspectorUrl ? (
          <a
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
            href={inspectorUrl}
            target="_blank"
            rel="noreferrer"
          >
            View deployment in Vercel <ExternalLink className="size-3" />
          </a>
        ) : (
          <p className="text-muted-foreground text-xs">
            Chief will share a Vercel dashboard link as soon as the deployment
            exists.
          </p>
        )}
      </div>
      <div className="space-y-3 py-1">
        {steps.map((step, index) => {
          const stepComplete = finished || (!error && index < activeIndex);
          const failed = Boolean(error) && index === activeIndex;
          const active = !finished && !error && index === activeIndex;
          const deployStep = index === 1;
          return (
            <div key={step.label} className="space-y-2">
              <div
                className={
                  active || stepComplete || failed
                    ? "flex items-center gap-3 text-sm"
                    : "text-muted-foreground flex items-center gap-3 text-sm"
                }
              >
                {stepComplete ? (
                  <Check className="size-4 text-emerald-500" />
                ) : failed ? (
                  <X className="text-destructive size-4" />
                ) : active ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <span className="border-muted-foreground/40 size-4 rounded-full border" />
                )}
                <span>{step.label}</span>
              </div>
              {deployStep ? (
                <VercelBuildLog
                  complete={stepComplete || Boolean(result)}
                  failed={
                    Boolean(error) &&
                    (failed || Boolean(progress?.logs?.length))
                  }
                  logs={progress?.logs ?? []}
                  readyState={progress?.readyState}
                  running={active}
                  startedAt={progress?.buildStartedAt}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      {error ? (
        <div className="border-destructive/30 bg-destructive/5 rounded-lg border p-3">
          <p className="text-destructive text-sm font-medium">
            Deployment stopped
          </p>
          <p className="text-muted-foreground mt-1 text-xs leading-5">
            {error}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function VercelBuildLog({
  complete,
  failed,
  logs,
  readyState,
  running,
  startedAt,
}: {
  complete: boolean;
  failed: boolean;
  logs: readonly EveDeploymentLogLine[];
  readyState?: VercelDeploymentReadyState;
  running: boolean;
  startedAt?: number;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expanded) return;
    const node = logRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [expanded, logs]);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running]);
  const elapsed = formatBuildDuration(Math.max(0, now - (startedAt ?? now)));
  const state = failed
    ? "Failed"
    : readyState
      ? readyStateLabel[readyState]
      : "Waiting for logs";
  return (
    <div className="border-border/60 ml-7 overflow-hidden rounded-lg border">
      <button
        type="button"
        aria-expanded={expanded}
        className="hover:bg-muted/40 flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded((open) => !open)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <ChevronRight
            className={
              expanded
                ? "text-muted-foreground size-3.5 rotate-90 transition-transform"
                : "text-muted-foreground size-3.5 transition-transform"
            }
          />
          <span className="text-xs font-medium">Build Logs</span>
          <span className="text-muted-foreground min-w-0 truncate text-[11px]">
            {collapsedBuildLogSummary({
              complete: complete && !running,
              failed,
              logs,
            })}
          </span>
        </span>
        <span
          className={
            failed || readyState === "ERROR"
              ? "text-destructive shrink-0 text-[11px] tabular-nums"
              : "text-muted-foreground shrink-0 text-[11px] tabular-nums"
          }
        >
          {elapsed}
          {running ? (
            <LoaderCircle className="ml-2 inline size-3 animate-spin" />
          ) : failed ? null : readyState === "READY" ? (
            <Check className="ml-2 inline size-3 text-emerald-500" />
          ) : null}
          <span className="sr-only">{state}</span>
        </span>
      </button>
      {expanded ? (
        <div
          ref={logRef}
          role="log"
          aria-live="polite"
          aria-label="Vercel build log"
          className={`overscroll-contain bg-zinc-950 px-3 py-2 font-mono text-[11px] leading-5 text-zinc-300 ${VERCEL_BUILD_LOG_BODY_CLASS}`}
        >
          {logs.length === 0 ? (
            <p className="text-zinc-500">Waiting for Vercel build output…</p>
          ) : (
            logs.map((line, index) => {
              const stamp = formatLogTimestamp(line.at);
              return (
                <p
                  key={`${line.source}:${index}:${line.at ?? 0}:${line.text.slice(0, 24)}`}
                  className={
                    line.source === "stderr" || line.source === "fatal"
                      ? "break-all whitespace-pre-wrap text-red-400"
                      : line.source === "command"
                        ? "break-all whitespace-pre-wrap text-zinc-100"
                        : "break-all whitespace-pre-wrap"
                  }
                >
                  {stamp ? (
                    <span className="mr-2 text-zinc-500 tabular-nums">
                      {stamp}
                    </span>
                  ) : null}
                  {line.source === "command" ? `▸ ${line.text}` : line.text}
                </p>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

export function EveProvisioningDialog({
  agentName,
  workspaceName,
  open,
  phase,
  progress,
  result,
  error,
  onClose,
}: {
  agentName: string;
  workspaceName: string;
  open: boolean;
  phase: EveConnectionPhase;
  progress: EveAgentProvisioningProgress | null;
  result?: EveAgentProvisioningResult | null;
  error?: string | null;
  onClose?: () => void;
}) {
  const terminal = Boolean(error ?? result);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && terminal && onClose?.()}
    >
      <DialogContent
        className="min-w-0 overflow-hidden sm:max-w-2xl [&>button]:hidden"
        onEscapeKeyDown={(event) => !terminal && event.preventDefault()}
        onInteractOutside={(event) => !terminal && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {result ? `${agentName} is ready` : `Connecting ${agentName}`}
          </DialogTitle>
          <DialogDescription>
            {result
              ? "Vercel Eve is connected to this workspace through Chief."
              : "Chief is deploying this agent to Vercel Eve."}
          </DialogDescription>
        </DialogHeader>
        <EveProvisioningStatus
          agentName={agentName}
          workspaceName={workspaceName}
          phase={phase}
          progress={progress}
          result={result}
          error={error}
        />
        {terminal ? (
          <div className="flex justify-end">
            <Button onClick={onClose}>{result ? "Done" : "Close"}</Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
