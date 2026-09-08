import { useState } from "react";
import {
  CalendarPlus,
  MoreHorizontal,
  Pencil,
  Repeat2,
  ShieldCheck,
} from "lucide-react";

import type { RecurringWorkRecord } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@chief/ui/components/dropdown-menu";
import { Input } from "@chief/ui/components/input";

import type { ScheduledDraft } from "./schedule-calendar-core";
import { AgentWorkingIndicator } from "../components/chat/agent-working-indicator";
import { agentName, workStatusLabel } from "./schedule-calendar-core";
import {
  approvalTiming,
  conciseApprovalSummary,
  friendlyPermission,
  friendlySchedule,
} from "./schedule-editor";
import { ScheduleRunHistory } from "./schedule-run-history";

export function RecurringWorkApprovalDialog({
  work,
  now,
  onClose,
  onApprove,
  onReject,
  revision,
}: {
  work: RecurringWorkRecord | null;
  now: number;
  onClose: () => void;
  onApprove: (work: RecurringWorkRecord) => void;
  onReject: (work: RecurringWorkRecord) => void;
  revision: {
    available: boolean;
    busy: boolean;
    note: string | null;
    onRequest: (feedback: string) => void;
  };
}) {
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const missedOneOff = Boolean(
    work?.onceAt !== undefined && work.onceAt <= now,
  );
  const summary = work ? conciseApprovalSummary(work) : null;
  const permissions = work
    ? [...new Set(work.proposedToolPatterns.map(friendlyPermission))]
    : [];
  const closeDialog = () => {
    setFeedback("");
    setShowFeedback(false);
    onClose();
  };
  const submitFeedback = () => {
    const text = feedback.trim();
    if (!text || revision.busy) return;
    setFeedback("");
    revision.onRequest(text);
  };
  return (
    <Dialog
      open={Boolean(work)}
      onOpenChange={(open) => !open && closeDialog()}
    >
      <DialogContent className="max-w-md overflow-hidden p-0">
        {work ? (
          <>
            <DialogHeader className="px-6 pt-6 pb-4 text-left">
              <div className="flex items-start gap-3.5 pr-8">
                <span className="bg-foreground text-background flex size-10 shrink-0 items-center justify-center rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
                  {work.onceAt === undefined ? (
                    <Repeat2 size={17} />
                  ) : (
                    <CalendarPlus size={17} />
                  )}
                </span>
                <div className="min-w-0 pt-0.5">
                  <DialogTitle className="text-xl leading-6 font-semibold tracking-[-0.02em]">
                    {work.onceAt === undefined
                      ? "Approve this schedule?"
                      : "Approve this task?"}
                  </DialogTitle>
                  <DialogDescription className="mt-1 text-xs leading-5">
                    {missedOneOff
                      ? "Its planned time has passed, so approval will run it now."
                      : work.onceAt === undefined
                        ? "Chief will handle this automatically until you pause or remove it."
                        : "Chief will handle this once at the planned time."}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="space-y-3 px-6 pb-6">
              <div className="bg-foreground/[0.035] rounded-2xl p-4 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent)]">
                <p className="text-[15px] leading-5 font-semibold tracking-[-0.015em]">
                  {work.title}
                </p>
                {summary ? (
                  <p className="text-muted-foreground mt-1.5 text-xs leading-5">
                    {summary}
                  </p>
                ) : null}
                <dl className="mt-4 grid grid-cols-[52px_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-black/[0.055] pt-3 text-xs dark:border-white/[0.055]">
                  <dt className="text-muted-foreground">When</dt>
                  <dd className="font-medium">{approvalTiming(work)}</dd>
                  <dt className="text-muted-foreground">Owner</dt>
                  <dd className="font-medium">{agentName(work.agentId)}</dd>
                </dl>
              </div>

              <div className="flex items-start gap-2.5 px-1 py-1">
                <ShieldCheck
                  size={15}
                  className="mt-0.5 shrink-0 text-emerald-500"
                />
                <p className="text-muted-foreground text-[11px] leading-4.5">
                  Scheduled work uses this agent's configured workspace
                  permissions. You can review those in Agents.
                </p>
              </div>

              {permissions.length > 0 ? (
                <details className="group rounded-xl border border-black/[0.055] px-3 py-2.5 dark:border-white/[0.055]">
                  <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center justify-between text-[11px] transition-colors marker:content-none">
                    <span>Requested connector actions</span>
                    <span className="tabular-nums">
                      {permissions.length}{" "}
                      {permissions.length === 1 ? "action" : "actions"}
                    </span>
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-1.5 border-t border-black/[0.055] pt-2.5 dark:border-white/[0.055]">
                    {permissions.slice(0, 4).map((permission) => (
                      <span
                        key={permission}
                        className="bg-foreground/[0.045] rounded-md px-2 py-1 text-[10px]"
                      >
                        {permission}
                      </span>
                    ))}
                    {permissions.length > 4 ? (
                      <span className="text-muted-foreground px-1 py-1 text-[10px]">
                        +{permissions.length - 4} more
                      </span>
                    ) : null}
                  </div>
                </details>
              ) : null}

              {revision.available && !showFeedback ? (
                <button
                  type="button"
                  onClick={() => setShowFeedback(true)}
                  className="text-muted-foreground hover:text-foreground flex items-center gap-2 px-1 py-1 text-[11px] font-medium transition-colors"
                >
                  <Pencil size={12} />
                  Ask Chief to change something
                </button>
              ) : null}

              {revision.available && showFeedback ? (
                <div className="bg-foreground/[0.025] rounded-xl p-3 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_5%,transparent)]">
                  <p className="mb-2 text-xs font-medium">
                    What should Chief change?
                  </p>
                  <div className="flex gap-2">
                    <Input
                      value={feedback}
                      onChange={(event) => setFeedback(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          submitFeedback();
                        }
                      }}
                      placeholder="For example, move it to Friday morning"
                      disabled={revision.busy}
                      className="h-8 text-sm"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={!feedback.trim() || revision.busy}
                      onClick={submitFeedback}
                    >
                      Ask
                    </Button>
                  </div>
                  {revision.busy ? (
                    <AgentWorkingIndicator className="mt-2" />
                  ) : revision.note ? (
                    <p className="text-muted-foreground mt-2 text-xs leading-5">
                      {revision.note}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <DialogFooter className="bg-foreground/[0.018] items-center border-t border-black/[0.055] px-6 py-4 dark:border-white/[0.055]">
              <button
                type="button"
                onClick={() => {
                  onReject(work);
                  closeDialog();
                }}
                className="text-muted-foreground hover:text-destructive mr-auto text-xs transition-colors"
              >
                Delete request
              </button>
              <Button
                disabled={revision.busy}
                onClick={() => {
                  onApprove(work);
                  closeDialog();
                }}
              >
                {missedOneOff
                  ? "Approve and run now"
                  : work.onceAt === undefined
                    ? "Approve schedule"
                    : "Approve task"}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function ScheduleEventDetailDialog({
  work,
  draft,
  onClose,
  onEditWork,
  onOpenDraft,
  onOpenWorkChannel,
  onTogglePause,
  onRunWork,
}: {
  work: RecurringWorkRecord | null;
  draft: ScheduledDraft | null;
  onClose: () => void;
  onEditWork: (work: RecurringWorkRecord) => void;
  onOpenDraft: (draft: ScheduledDraft) => void;
  onOpenWorkChannel: (work: RecurringWorkRecord) => void;
  onTogglePause: (work: RecurringWorkRecord) => void;
  onRunWork: (work: RecurringWorkRecord) => void;
}) {
  const open = Boolean(work ?? draft);
  const content = (work?.instructions ?? draft?.body ?? "").trim();
  const source = work ? agentName(work.agentId) : draft?.platform;
  const status = work
    ? workStatusLabel(work.status)
    : draft
      ? draft.status[0]?.toUpperCase() + draft.status.slice(1)
      : "";
  const timing = work
    ? friendlySchedule(work)
    : draft?.scheduledFor
      ? new Date(draft.scheduledFor).toLocaleString([], {
          weekday: "long",
          month: "long",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "Awaiting a time";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="border-border/80 w-[calc(100%-32px)] max-w-[480px] gap-0 overflow-hidden rounded-xl p-0 shadow-[0_16px_64px_-12px_rgb(0_0_0/0.45)]">
        {work || draft ? (
          <>
            <DialogHeader className="space-y-1 px-5 pt-5 pr-12 pb-4 text-left">
              <DialogTitle className="text-[17px] leading-6 font-medium tracking-tight">
                {work?.title ?? draft?.title}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {source}
                {work ? ` · ${work.timezone}` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="px-5 pb-5">
              <p className="text-foreground/85 max-h-56 overflow-y-auto text-[13px] leading-6 whitespace-pre-wrap">
                {content.length > 0 ? content : "No additional details."}
              </p>
              <dl className="border-border/60 mt-5 space-y-3 border-t pt-4 text-xs">
                <div className="flex items-baseline justify-between gap-6">
                  <dt className="text-muted-foreground">Schedule</dt>
                  <dd className="text-right">{timing}</dd>
                </div>
                <div className="flex items-center justify-between gap-6">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="flex items-center gap-1.5">
                    <span
                      className={`size-1.5 rounded-full ${work?.status === "active" ? "bg-emerald-500" : "bg-muted-foreground/50"}`}
                    />
                    {status}
                  </dd>
                </div>
              </dl>
              {work?.collaborators?.length ? (
                <p className="text-muted-foreground mt-3 text-xs">
                  Team:{" "}
                  {[work.agentId, ...work.collaborators]
                    .map(agentName)
                    .join(", ")}
                </p>
              ) : null}
              {work?.expectedOutcome ? (
                <p className="mt-3 text-xs leading-5">{work.expectedOutcome}</p>
              ) : null}
              {work ? (
                <ScheduleRunHistory key={work.id} scheduleId={work.id} />
              ) : null}
            </div>
            <DialogFooter className="border-border/60 items-center border-t px-4 py-3">
              {work?.conversationId ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground mr-auto rounded-md px-2 text-xs"
                  onClick={() => onOpenWorkChannel(work)}
                >
                  Open channel
                </Button>
              ) : (
                <span className="mr-auto" />
              )}
              {work ? (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="rounded-md"
                        aria-label="Schedule actions"
                      >
                        <MoreHorizontal size={16} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="min-w-36 rounded-lg p-1"
                    >
                      <DropdownMenuItem
                        className="rounded-md text-xs"
                        onSelect={() => onTogglePause(work)}
                      >
                        {work.status === "active"
                          ? "Pause schedule"
                          : "Resume schedule"}
                      </DropdownMenuItem>
                      {work.status === "active" ? (
                        <DropdownMenuItem
                          className="rounded-md text-xs"
                          onSelect={() => onRunWork(work)}
                        >
                          Run now
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    size="sm"
                    className="rounded-md text-xs"
                    onClick={() => onEditWork(work)}
                  >
                    Edit schedule
                  </Button>
                </>
              ) : draft?.fileId ? (
                <Button
                  size="sm"
                  className="rounded-md text-xs"
                  onClick={() => onOpenDraft(draft)}
                >
                  Open draft
                </Button>
              ) : null}
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
