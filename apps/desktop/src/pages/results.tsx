import { useMemo, useState } from "react";
import { Check, MoreVertical, SlidersHorizontal, Trash2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";

import type {
  AttentionItem,
  RecurringWorkRecord,
  RecurringWorkRunRecord,
  RunResultArtifact,
} from "@chief/agent-runtime/types";
import { defaultAgents } from "@chief/agent-runtime/agents";
import { Button } from "@chief/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";
import { cn } from "@chief/ui/lib/utils";

import { AgentChat } from "../components/chat/agent-chat";
import { StreamingMarkdown } from "../components/chat/streaming-markdown";
import { renderGenerativePart } from "../components/generative-ui/registry";
import { useAuth } from "../lib/auth/auth-context";
import { createChat } from "../lib/chat-log";
import { useWorkspaceData } from "../lib/runtime";

function statusLabel(status: RecurringWorkRunRecord["status"]) {
  if (status === "running") return "Running";
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  return "Stopped";
}

function resultText(run: RecurringWorkRunRecord) {
  if (run.status === "running") return "This work is running now.";
  return (
    run.summary?.trim() ||
    run.error?.trim() ||
    "No output was recorded."
  ).replace(/—/g, ". ");
}

function runTitle(work: RecurringWorkRecord | undefined) {
  return work?.title ?? "Scheduled work";
}

function attentionWorkId(item: AttentionItem | undefined) {
  return item?.sourceId?.startsWith("automation-")
    ? item.sourceId.slice("automation-".length)
    : undefined;
}

function derivedArtifacts(run: RecurringWorkRunRecord): RunResultArtifact[] {
  if (run.artifacts?.length) return run.artifacts;
  const comparison = run.summary?.match(
    /(?:^|\n)([^.\n]{3,80}?)\s+(?:increased|decreased|rose|fell)\s+from\s+([\d,.]+)\s+to\s+([\d,.]+)/i,
  );
  if (!comparison) return [];
  const previous = Number(comparison[2]!.replace(/,/g, ""));
  const latest = Number(comparison[3]!.replace(/,/g, ""));
  if (!Number.isFinite(previous) || !Number.isFinite(latest)) return [];
  const title = comparison[1]!.trim().replace(/^program(?:'s|’s)?\s+/i, "");
  return [
    {
      type: "data-chart",
      id: "summary-comparison",
      data: {
        kind: "line",
        title: title.replace(/^./, (character) => character.toUpperCase()),
        subtitle: "Comparison reported by the scheduled run",
        yLabel: title,
        series: [
          {
            id: "reported-comparison",
            label: "Reported value",
            points: [
              { x: "Previous", value: previous },
              { x: "Latest", value: latest },
            ],
          },
        ],
      },
    },
  ];
}

function ResultArtifact({ artifact }: { artifact: RunResultArtifact }) {
  return renderGenerativePart(artifact, ["analytics-chart"]);
}

type RunOutcome = "successful" | "failed";

function RunHistoryFilters({
  visibleOutcomes,
  onToggle,
}: {
  visibleOutcomes: ReadonlySet<RunOutcome>;
  onToggle: (outcome: RunOutcome) => void;
}) {
  const options: {
    outcome: RunOutcome;
    label: string;
    detail: string;
    color: string;
  }[] = [
    {
      outcome: "successful",
      label: "Successful",
      detail: "Completed runs",
      color: "bg-foreground",
    },
    {
      outcome: "failed",
      label: "Failed",
      detail: "Runs that stopped with an error",
      color: "bg-destructive",
    },
  ];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground flex h-7 items-center gap-1.5 px-2 text-xs transition-colors"
        >
          <SlidersHorizontal size={12} />
          Filter
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        <p className="text-muted-foreground px-2 py-1.5 text-[10px]">
          Show runs
        </p>
        {options.map((option) => {
          const checked = visibleOutcomes.has(option.outcome);
          return (
            <button
              key={option.outcome}
              type="button"
              onClick={() => onToggle(option.outcome)}
              className="hover:bg-accent flex w-full items-center gap-3 px-2 py-2 text-left transition-colors"
            >
              <span className={cn("size-1.5 shrink-0", option.color)} />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium">
                  {option.label}
                </span>
                <span className="text-muted-foreground block text-[10px]">
                  {option.detail}
                </span>
              </span>
              <span className="flex size-4 shrink-0 items-center justify-center border">
                {checked ? <Check size={11} /> : null}
              </span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

function RunIssue({
  run,
  reason,
  onRetry,
  onDismiss,
}: {
  run: RecurringWorkRunRecord;
  reason: string;
  onRetry: () => void;
  onDismiss?: () => void;
}) {
  const requiresAccess = Boolean(run.blockedTools?.length);
  return (
    <div className="flex flex-wrap items-start justify-between gap-5 border-b py-5">
      <div className="flex max-w-3xl min-w-0 items-start gap-3">
        <span
          className={cn(
            "mt-2 size-1.5 shrink-0",
            run.status === "failed" ? "bg-destructive" : "bg-amber-400",
          )}
        />
        <div>
          <p className="text-sm font-medium">
            {run.status === "failed" ? "Run failed" : "Run stopped"}
          </p>
          <p className="text-muted-foreground mt-1 text-sm leading-6">
            {reason}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="text-muted-foreground hover:text-foreground text-xs transition-colors"
          >
            Dismiss
          </button>
        ) : null}
        <Button size="sm" onClick={onRetry}>
          {requiresAccess ? "Allow and retry" : "Try again"}
        </Button>
      </div>
    </div>
  );
}

export function ResultsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { cloudOrganizationId } = useAuth();
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const viewedStorageKey = `chief:run-history:viewed:${cloudOrganizationId ?? "local"}`;
  const legacyViewedStorageKey = `marketer:run-history:viewed:${cloudOrganizationId ?? "local"}`;
  const [viewedRunIds, setViewedRunIds] = useState<Set<string>>(() => {
    try {
      const stored =
        localStorage.getItem(viewedStorageKey) ??
        localStorage.getItem(legacyViewedStorageKey) ??
        "[]";
      if (!localStorage.getItem(viewedStorageKey) && stored !== "[]") {
        localStorage.setItem(viewedStorageKey, stored);
        localStorage.removeItem(legacyViewedStorageKey);
      }
      return new Set(JSON.parse(stored) as string[]);
    } catch {
      return new Set();
    }
  });
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedAttentionId, setSelectedAttentionId] = useState<string | null>(
    null,
  );
  const [visibleOutcomes, setVisibleOutcomes] = useState<Set<RunOutcome>>(
    () => new Set<RunOutcome>(["successful"]),
  );
  const workById = useMemo(
    () => new Map(workspaceData.recurringWork.map((work) => [work.id, work])),
    [workspaceData.recurringWork],
  );
  const allRuns = useMemo(() => {
    return [...workspaceData.recurringWorkRuns].sort(
      (a, b) => b.startedAt - a.startedAt,
    );
  }, [workspaceData.recurringWorkRuns]);
  const runGroups = useMemo(() => {
    const groups = new Map<
      string,
      { run: RecurringWorkRunRecord; attemptCount: number }
    >();
    for (const run of allRuns) {
      const current = groups.get(run.recurringWorkId);
      if (current) {
        current.attemptCount += 1;
      } else {
        groups.set(run.recurringWorkId, { run, attemptCount: 1 });
      }
    }
    return [...groups.values()].sort(
      (a, b) => b.run.startedAt - a.run.startedAt,
    );
  }, [allRuns]);
  const visibleRunGroups = useMemo(
    () =>
      runGroups.filter(({ run }) => {
        if (run.status === "completed") {
          return visibleOutcomes.has("successful");
        }
        if (run.status === "failed") {
          return visibleOutcomes.has("failed");
        }
        return true;
      }),
    [runGroups, visibleOutcomes],
  );
  const attentionByWorkId = useMemo(
    () =>
      new Map(
        workspaceData.attentionItems.flatMap((item) =>
          item.sourceId?.startsWith("automation-")
            ? [[item.sourceId.slice("automation-".length), item] as const]
            : [],
        ),
      ),
    [workspaceData.attentionItems],
  );
  const workIdsWithRuns = useMemo(
    () => new Set(allRuns.map((run) => run.recurringWorkId)),
    [allRuns],
  );
  const standaloneAttentionItems = useMemo(
    () =>
      workspaceData.attentionItems.filter((item) => {
        const workId = attentionWorkId(item);
        return !workId || !workIdsWithRuns.has(workId);
      }),
    [workspaceData.attentionItems, workIdsWithRuns],
  );
  const requestedWorkId = params.get("work");
  const requestedRunId = params.get("run");
  const requestedAttention = workspaceData.attentionItems.find(
    (item) => item.id === params.get("attention"),
  );
  const requestedAttentionWorkId = attentionWorkId(requestedAttention);
  const requestedStandaloneAttention = requestedAttention
    ? standaloneAttentionItems.find((item) => item.id === requestedAttention.id)
    : undefined;
  const selectedStandaloneAttention =
    standaloneAttentionItems.find((item) => item.id === selectedAttentionId) ??
    (!selectedRunId ? requestedStandaloneAttention : undefined) ??
    (!selectedRunId && !requestedRunId && !requestedWorkId
      ? standaloneAttentionItems[0]
      : undefined);
  const selectedRun = selectedStandaloneAttention
    ? undefined
    : (visibleRunGroups.find(({ run }) => run.id === selectedRunId)?.run ??
      allRuns.find((run) => run.id === requestedRunId) ??
      allRuns.find((run) => run.recurringWorkId === requestedAttentionWorkId) ??
      allRuns.find((run) => run.recurringWorkId === requestedWorkId) ??
      visibleRunGroups[0]?.run);
  const selectedWork = selectedRun
    ? workById.get(selectedRun.recurringWorkId)
    : undefined;
  const selectedAgent = selectedWork
    ? defaultAgents.find((agent) => agent.id === selectedWork.agentId)
    : undefined;
  const selectedAttentionAgent = selectedStandaloneAttention
    ? defaultAgents.find(
        (agent) => agent.id === selectedStandaloneAttention.agentId,
      )
    : undefined;
  const selectedArtifacts = selectedRun ? derivedArtifacts(selectedRun) : [];
  const selectedAttention = selectedRun
    ? attentionByWorkId.get(selectedRun.recurringWorkId)
    : undefined;
  const selectedHasIssue =
    selectedRun?.status === "failed" ||
    selectedRun?.status === "needs_approval";
  const markViewed = (runId: string) => {
    setViewedRunIds((current) => {
      if (current.has(runId)) return current;
      const next = new Set(current);
      next.add(runId);
      localStorage.setItem(viewedStorageKey, JSON.stringify([...next]));
      return next;
    });
  };

  return (
    <div className="-mx-8 -mb-8 flex h-[calc(100vh-48px)] min-w-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b px-8 pt-4 pb-5">
        <h1 className="font-serif text-3xl">Run history</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          See what ran and retry anything that stopped.
        </p>
      </header>

      {runGroups.length > 0 || standaloneAttentionItems.length > 0 ? (
        <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-r p-4">
            {standaloneAttentionItems.length > 0 ? (
              <div className="mb-5">
                <p className="text-muted-foreground mb-2 px-3 text-xs font-medium">
                  Needs attention
                </p>
                <div className="space-y-1">
                  {standaloneAttentionItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSelectedAttentionId(item.id);
                        setSelectedRunId(null);
                      }}
                      className={cn(
                        "hover:bg-accent/50 flex w-full items-start gap-2.5 border border-transparent px-3 py-2.5 text-left transition-colors",
                        selectedStandaloneAttention?.id === item.id &&
                          "border-border bg-accent",
                      )}
                    >
                      <span className="mt-1.5 size-1.5 shrink-0 bg-amber-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {item.title}
                        </span>
                        <span className="text-muted-foreground mt-1 block text-xs">
                          {new Date(item.createdAt).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                          {` · ${item.agentId}`}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="mb-2 flex items-center justify-between gap-3 px-3">
              <p className="text-muted-foreground text-xs font-medium">
                Recent work
              </p>
              <RunHistoryFilters
                visibleOutcomes={visibleOutcomes}
                onToggle={(outcome) =>
                  setVisibleOutcomes((current) => {
                    const next = new Set(current);
                    if (next.has(outcome)) next.delete(outcome);
                    else next.add(outcome);
                    return next;
                  })
                }
              />
            </div>
            <div className="space-y-1">
              {visibleRunGroups.map(({ run, attemptCount }) => {
                const work = workById.get(run.recurringWorkId);
                const active = selectedRun?.id === run.id;
                const needsAttention =
                  run.status === "needs_approval" ||
                  run.status === "failed" ||
                  attentionByWorkId.has(run.recurringWorkId);
                const isNew = !viewedRunIds.has(run.id);
                return (
                  <div
                    key={run.id}
                    className={cn(
                      "group/run hover:bg-accent/50 flex w-full items-start border border-transparent transition-colors",
                      active && "border-border bg-accent",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedRunId(run.id);
                        setSelectedAttentionId(null);
                        markViewed(run.id);
                      }}
                      className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2.5 text-left"
                    >
                      <span
                        className={cn(
                          "mt-1.5 size-1.5 shrink-0",
                          run.status === "running" &&
                            "animate-pulse bg-emerald-500",
                          run.status === "completed" && "bg-foreground",
                          run.status === "failed" && "bg-destructive",
                          run.status === "needs_approval" && "bg-amber-400",
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {runTitle(work)}
                        </span>
                        <span className="text-muted-foreground mt-1 block text-xs">
                          {new Date(run.scheduledFor).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                          {work ? ` · ${work.agentId}` : ""}
                        </span>
                        {attemptCount > 1 ? (
                          <span className="text-muted-foreground/70 mt-1 block text-[10px]">
                            {attemptCount - 1} earlier{" "}
                            {attemptCount === 2 ? "attempt" : "attempts"}
                          </span>
                        ) : null}
                        {isNew || needsAttention ? (
                          <span className="mt-2 flex flex-wrap gap-1.5">
                            {isNew ? (
                              <span className="border-border text-foreground border px-1.5 py-0.5 text-[10px] font-medium">
                                New
                              </span>
                            ) : null}
                            {needsAttention ? (
                              <span className="px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                                Stopped
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    <Popover>
                      <PopoverTrigger
                        aria-label={`Manage ${runTitle(work)}`}
                        className="text-muted-foreground hover:text-foreground mt-1.5 mr-1 flex size-7 shrink-0 items-center justify-center opacity-0 transition-opacity group-hover/run:opacity-100 data-[state=open]:opacity-100"
                      >
                        <MoreVertical size={14} />
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-44 p-1">
                        <button
                          type="button"
                          onClick={() => {
                            workspaceData.deleteRecurringWorkRun(run.id);
                            if (selectedRunId === run.id) {
                              setSelectedRunId(null);
                            }
                          }}
                          className="text-destructive hover:bg-destructive/10 flex w-full items-center gap-2 px-2 py-2 text-left text-xs transition-colors"
                        >
                          <Trash2 size={13} />
                          Delete run
                        </button>
                      </PopoverContent>
                    </Popover>
                  </div>
                );
              })}
              {visibleRunGroups.length === 0 ? (
                <p className="text-muted-foreground px-3 py-6 text-xs">
                  No runs match these filters.
                </p>
              ) : null}
            </div>
          </aside>

          <main className="min-h-0 min-w-0 overflow-y-auto px-8 py-7">
            {selectedStandaloneAttention ? (
              <div className="mx-auto max-w-6xl">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
                  <div>
                    <p className="text-muted-foreground text-xs">
                      Needs attention · {selectedStandaloneAttention.agentId}
                    </p>
                    <h2 className="mt-2 font-serif text-3xl">
                      {selectedStandaloneAttention.title}
                    </h2>
                    <p className="text-muted-foreground mt-2 text-xs">
                      {new Date(
                        selectedStandaloneAttention.createdAt,
                      ).toLocaleString([], {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        workspaceData.dismissAttentionItem(
                          selectedStandaloneAttention.id,
                        );
                        setSelectedAttentionId(null);
                      }}
                    >
                      Mark resolved
                    </Button>
                    {selectedAttentionAgent ? (
                      <Button
                        size="sm"
                        onClick={() => {
                          const chat = createChat(
                            selectedAttentionAgent.id,
                            `Resolve: ${selectedStandaloneAttention.title}`,
                          );
                          const draft = [
                            "Resolve this action item and complete as much of the original work as possible.",
                            "",
                            selectedStandaloneAttention.reason,
                          ].join("\n");
                          navigate(
                            `/conversations?agent=${encodeURIComponent(selectedAttentionAgent.id)}&chat=${encodeURIComponent(chat.id)}&new=1&draft=${encodeURIComponent(draft)}`,
                          );
                        }}
                      >
                        Continue with {selectedAttentionAgent.name}
                      </Button>
                    ) : null}
                  </div>
                </div>
                <article className="chat-markdown mx-auto max-w-3xl py-7 text-sm leading-7">
                  <p className="text-muted-foreground mb-3 text-xs font-medium">
                    Action item
                  </p>
                  <StreamingMarkdown>
                    {selectedStandaloneAttention.reason}
                  </StreamingMarkdown>
                </article>
              </div>
            ) : selectedRun ? (
              <div className="mx-auto max-w-6xl">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
                  <div>
                    <p className="text-muted-foreground text-xs">
                      {statusLabel(selectedRun.status)}
                      {selectedWork ? ` · ${selectedWork.agentId}` : ""}
                    </p>
                    <h2 className="mt-2 font-serif text-3xl">
                      {runTitle(selectedWork)}
                    </h2>
                    <p className="text-muted-foreground mt-2 text-xs">
                      {new Date(selectedRun.scheduledFor).toLocaleString([], {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  {selectedWork && selectedRun.status !== "running" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const chat = createChat(
                          selectedWork.agentId,
                          `Follow up: ${runTitle(selectedWork)}`,
                        );
                        const draft = [
                          "Continue from this agent run.",
                          "",
                          resultText(selectedRun),
                        ].join("\n");
                        navigate(
                          `/conversations?agent=${encodeURIComponent(selectedWork.agentId)}&chat=${encodeURIComponent(chat.id)}&new=1&draft=${encodeURIComponent(draft)}`,
                        );
                      }}
                    >
                      Start conversation
                    </Button>
                  ) : null}
                </div>
                {selectedHasIssue ? (
                  <RunIssue
                    run={selectedRun}
                    reason={
                      selectedAttention?.reason ?? resultText(selectedRun)
                    }
                    onDismiss={
                      selectedAttention
                        ? () =>
                            workspaceData.dismissAttentionItem(
                              selectedAttention.id,
                            )
                        : undefined
                    }
                    onRetry={() => {
                      if (selectedRun.blockedTools?.length) {
                        workspaceData.expandRecurringWorkGrant(
                          selectedRun.recurringWorkId,
                          selectedRun.blockedTools,
                          true,
                        );
                      } else {
                        workspaceData.runRecurringWorkNow(
                          selectedRun.recurringWorkId,
                        );
                      }
                    }}
                  />
                ) : null}
                {selectedRun.status === "running" && selectedAgent ? (
                  <div className="h-[calc(100vh-260px)] min-h-[440px]">
                    <AgentChat
                      agent={selectedAgent}
                      chatId={`automation-run-${selectedRun.id}`}
                      observeOnly
                    />
                  </div>
                ) : (
                  <div
                    className={cn(
                      "py-7",
                      selectedArtifacts.length
                        ? "grid items-start gap-8 xl:grid-cols-[minmax(320px,0.85fr)_minmax(440px,1.15fr)]"
                        : "mx-auto max-w-3xl",
                    )}
                  >
                    {!selectedHasIssue ? (
                      <article className="chat-markdown text-sm leading-7">
                        <p className="text-muted-foreground mb-3 text-xs font-medium">
                          Analysis
                        </p>
                        <StreamingMarkdown>
                          {resultText(selectedRun)}
                        </StreamingMarkdown>
                      </article>
                    ) : null}
                    {selectedArtifacts.length ? (
                      <aside
                        aria-label="Report evidence"
                        className={cn(
                          "min-w-0 space-y-4",
                          selectedArtifacts.length === 1 &&
                            "xl:sticky xl:top-0 xl:self-start",
                        )}
                      >
                        <p className="text-muted-foreground text-xs font-medium">
                          Evidence
                        </p>
                        {selectedArtifacts.map((artifact) => (
                          <ResultArtifact
                            key={artifact.id}
                            artifact={artifact}
                          />
                        ))}
                      </aside>
                    ) : null}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                No runs match these filters.
              </div>
            )}
          </main>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center px-8 text-center">
          <div>
            <p className="font-serif text-2xl">No results yet</p>
            <p className="text-muted-foreground mt-2 max-w-sm text-sm leading-6">
              Reports and other scheduled output will appear here after the
              first run.
            </p>
            <Button
              variant="outline"
              className="mt-5"
              onClick={() => navigate("/schedule")}
            >
              Open Schedule
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
