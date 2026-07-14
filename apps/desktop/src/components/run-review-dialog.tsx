import { useNavigate } from "react-router";
import { ShieldCheck } from "lucide-react";
import type {
  AttentionItem,
  RecurringWorkRunRecord,
} from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { StreamingMarkdown } from "./chat/streaming-markdown";

/**
 * Lightweight preview for a run or attention item. The full transcript,
 * artifacts, and recovery actions live in Run History.
 */
export interface RunReview {
  title: string;
  agentId: string;
  /** The automation id when this review concerns a recurring run. */
  recurringWorkId?: string;
  /** Exact run to open in Run History. */
  runId?: string;
  /** Attention item to clear on dismiss, when one raised this review. */
  attentionItemId?: string;
  detail: string;
  status?: RecurringWorkRunRecord["status"];
  at?: number;
  blockedTools: string[];
}

function humanizeAddress(address: string) {
  return (
    address
      .split(".")
      .at(-1)
      ?.replace(/([A-Z])/g, " $1")
      .replace(/^./, (character) => character.toUpperCase()) ?? address
  );
}

function statusLabel(status: RunReview["status"]) {
  if (status === "running") return "Running now";
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  if (status === "needs_approval") return "Stopped for approval";
  return null;
}

export function RunReviewDialog({
  review,
  onClose,
  onDismiss,
  onAllowAndRerun,
  onRerun,
}: {
  review: RunReview | null;
  onClose: () => void;
  onDismiss: (review: RunReview) => void;
  onAllowAndRerun: (review: RunReview) => void;
  onRerun: (review: RunReview) => void;
}) {
  const navigate = useNavigate();
  const openRun = (target: RunReview) => {
    onClose();
    navigate(
      target.runId
        ? `/schedule/history?run=${encodeURIComponent(target.runId)}`
        : `/schedule/history?work=${encodeURIComponent(target.recurringWorkId ?? "")}`,
    );
  };
  const canAllow = Boolean(
    review?.recurringWorkId && review.blockedTools.length > 0,
  );
  const hasRun = Boolean(review?.runId || review?.recurringWorkId);
  const analyticsRouteMismatch = Boolean(
    review?.blockedTools.includes(
      "tools.chief.org.workspace.agentTools.analyticsRunReport",
    ),
  );

  return (
    <Dialog open={Boolean(review)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        {review ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">
                {review.title}
              </DialogTitle>
              <DialogDescription>
                {[
                  statusLabel(review.status),
                  review.at
                    ? new Date(review.at).toLocaleString([], {
                        weekday: "long",
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Flagged by your agents"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {analyticsRouteMismatch ? (
                <div className="border p-4">
                  <p className="text-sm font-medium">
                    Live analytics was not read
                  </p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    The Analyst chose the cached report path instead of the live
                    Google Analytics tool this task already has approval to use.
                    No Google permission was removed and nothing was changed.
                  </p>
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    Reconnect Google Analytics if prompted, then rerun this
                    report. It does not need broader access.
                  </p>
                </div>
              ) : (
                <div className="chat-markdown max-h-44 overflow-y-auto border p-4 text-sm leading-6 text-muted-foreground">
                  <StreamingMarkdown>{review.detail}</StreamingMarkdown>
                </div>
              )}
              {canAllow && !analyticsRouteMismatch ? (
                <div>
                  <p className="text-xs font-medium">Approval needed</p>
                  <div className="mt-2 space-y-1.5">
                    {review.blockedTools.map((address) => (
                      <div
                        key={address}
                        className="flex items-center gap-2 border px-3 py-2"
                      >
                        <ShieldCheck
                          size={13}
                          className="shrink-0 text-amber-400"
                        />
                        <span className="min-w-0 truncate text-xs">
                          {humanizeAddress(address)}
                        </span>
                        <span className="ml-auto max-w-56 truncate font-mono text-[9px] text-muted-foreground">
                          {address}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    Nothing ran through these tools. Allowing them expands only
                    this automation, then reruns it.
                  </p>
                </div>
              ) : null}
            </div>
            <DialogFooter className="items-center">
              {review.attentionItemId ? (
                <button
                  type="button"
                  onClick={() => {
                    onDismiss(review);
                    onClose();
                  }}
                  className="mr-auto text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  Dismiss
                </button>
              ) : null}
              {hasRun ? (
                <Button variant="outline" onClick={() => openRun(review)}>
                  Open run
                </Button>
              ) : null}
              {canAllow ? (
                analyticsRouteMismatch ? (
                  <Button
                    onClick={() => {
                      onRerun(review);
                      onClose();
                    }}
                  >
                    Rerun report
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      onAllowAndRerun(review);
                      onClose();
                    }}
                  >
                    Allow and rerun
                  </Button>
                )
              ) : (
                <Button variant="outline" onClick={onClose}>
                  Close
                </Button>
              )}
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Builds a review from an attention item plus the automation's run data. */
export function reviewFromAttention(
  item: AttentionItem,
  runs: RecurringWorkRunRecord[],
): RunReview {
  const recurringWorkId = item.sourceId?.startsWith("automation-")
    ? item.sourceId.slice("automation-".length)
    : undefined;
  const latest = recurringWorkId
    ? runs
        .filter((run) => run.recurringWorkId === recurringWorkId)
        .sort((a, b) => b.startedAt - a.startedAt)[0]
    : undefined;
  return {
    title: item.title,
    agentId: item.agentId,
    recurringWorkId,
    runId: latest?.id,
    attentionItemId: item.id,
    detail: item.reason,
    status: latest?.status,
    at: latest?.startedAt ?? item.createdAt,
    blockedTools: latest?.blockedTools ?? [],
  };
}
