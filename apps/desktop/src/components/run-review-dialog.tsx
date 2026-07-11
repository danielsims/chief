import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ShieldCheck } from "lucide-react";
import type {
  AttentionItem,
  RecurringWorkRunRecord,
} from "@marketer/agent-runtime/types";
import { Button } from "@marketer/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@marketer/ui/components/dialog";
import { Input } from "@marketer/ui/components/input";
import { useAgentConfig } from "../lib/agent-config";
import { useAgentChat } from "../lib/runtime";

/**
 * Where a run or attention item gets RESOLVED: the outcome, the exact tools
 * it was blocked on (one-click approval), and a reply box that speaks
 * straight into the automation's conversation — read, act, move on, without
 * ever opening the chat.
 */
export interface RunReview {
  title: string;
  agentId: string;
  /** The automation id when this review concerns a recurring run. */
  recurringWorkId?: string;
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
}: {
  review: RunReview | null;
  onClose: () => void;
  onDismiss: (review: RunReview) => void;
  onAllowAndRerun: (review: RunReview) => void;
}) {
  const navigate = useNavigate();
  const agentConfig = useAgentConfig();
  const driver = agentConfig.forAgent(review?.agentId ?? "cmo").driver;
  const chatId = review?.recurringWorkId
    ? `automation-${review.recurringWorkId}`
    : undefined;
  const { chat, send, sessionReady } = useAgentChat(
    review && chatId && driver ? review.agentId : null,
    driver,
    chatId,
    "full",
  );
  const [reply, setReply] = useState("");
  // Only show replies from THIS review session, not the whole history.
  const openedAtItems = useRef(0);
  const [sentAny, setSentAny] = useState(false);
  useEffect(() => {
    if (review) {
      setReply("");
      setSentAny(false);
    }
  }, [review]);
  useEffect(() => {
    if (sessionReady && !sentAny) openedAtItems.current = chat.items.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionReady]);
  const freshReply = useMemo(() => {
    for (let i = chat.items.length - 1; i >= openedAtItems.current; i -= 1) {
      const item = chat.items[i];
      if (!item || item.kind !== "assistant") continue;
      const text = item.event.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join(" ")
        .trim();
      if (text) return text;
    }
    return null;
  }, [chat.items]);

  const submitReply = () => {
    const text = reply.trim();
    if (!text || chat.status === "running") return;
    setReply("");
    setSentAny(true);
    send(text);
  };

  const openConversation = (target: RunReview) => {
    onClose();
    navigate(
      `/conversations?agent=${target.agentId}&chat=automation-${target.recurringWorkId}`,
    );
  };
  const canAllow = Boolean(
    review?.recurringWorkId && review.blockedTools.length > 0,
  );
  const hasConversation = Boolean(review?.recurringWorkId);

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
              <p className="max-h-44 overflow-y-auto border p-4 text-sm leading-6 text-muted-foreground">
                {review.detail}
              </p>
              {canAllow ? (
                <div>
                  <p className="text-xs font-medium">What it needs</p>
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
                    Allowing adds exactly these tools to the automation's
                    approval.
                  </p>
                </div>
              ) : null}
              {hasConversation && driver ? (
                <div className="border-t pt-3">
                  <div className="flex gap-2">
                    <Input
                      value={reply}
                      onChange={(event) => setReply(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          submitReply();
                        }
                      }}
                      placeholder={`Tell ${review.agentId} what to do…`}
                      disabled={chat.status === "running"}
                      className="h-8 text-sm"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={!reply.trim() || chat.status === "running"}
                      onClick={submitReply}
                    >
                      Send
                    </Button>
                  </div>
                  {chat.status === "running" ? (
                    chat.streaming ? (
                      <p className="mt-2 max-h-32 overflow-y-auto text-xs leading-5 text-muted-foreground">
                        {chat.streaming.slice(-600)}
                      </p>
                    ) : (
                      <p className="agent-working mt-2 font-mono text-xs">
                        working…
                      </p>
                    )
                  ) : freshReply ? (
                    <p className="mt-2 max-h-40 overflow-y-auto text-xs leading-5 text-muted-foreground">
                      {freshReply}
                    </p>
                  ) : null}
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
              {hasConversation ? (
                <Button
                  variant="outline"
                  onClick={() => openConversation(review)}
                >
                  Open conversation
                </Button>
              ) : null}
              {canAllow ? (
                <Button
                  onClick={() => {
                    onAllowAndRerun(review);
                    onClose();
                  }}
                >
                  Allow and rerun
                </Button>
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
    attentionItemId: item.id,
    detail: item.reason,
    status: latest?.status,
    at: latest?.startedAt ?? item.createdAt,
    blockedTools: latest?.blockedTools ?? [],
  };
}
