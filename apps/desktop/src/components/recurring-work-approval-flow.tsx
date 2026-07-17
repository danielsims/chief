import { useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";

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
import { Input } from "@chief/ui/components/input";

import { messageBlocks, useChiefChat } from "../lib/runtime";

/**
 * The one approval surface for proposed recurring work, usable from any
 * page: approve and activate, reject outright, or ask for a change and watch
 * the revised plan stream into the open card. Owns its own revision session.
 */
export function RecurringWorkApprovalFlow({
  work,
  onClose,
  onApprove,
  onReject,
}: {
  work: RecurringWorkRecord | null;
  onClose: () => void;
  onApprove: (work: RecurringWorkRecord) => void;
  onReject: (work: RecurringWorkRecord) => void;
}) {
  const revisionChat = useChiefChat(work?.chatId ?? null);
  const revisionNote = useMemo(() => {
    for (let i = revisionChat.messages.length - 1; i >= 0; i -= 1) {
      const item = revisionChat.messages[i]!;
      if (item.role !== "assistant") continue;
      const text = messageBlocks(item)
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join(" ")
        .trim();
      if (text) return text;
    }
    return null;
  }, [revisionChat.messages]);
  const busy =
    !revisionChat.chatReady || revisionChat.controls.status === "running";
  const [feedback, setFeedback] = useState("");

  const requestRevision = () => {
    const text = feedback.trim();
    if (!work || !text || busy) return;
    setFeedback("");
    const draft = {
      id: work.id,
      agentId: work.agentId,
      title: work.title,
      cron: work.cron,
      timezone: work.timezone,
      instructions: work.instructions,
      approvalSummary: work.approvalSummary,
      proposedToolPatterns: work.proposedToolPatterns,
    };
    void revisionChat.sendMessage({
      text: [
        "The user is reviewing a draft recurring-work approval and asked for a change before approving.",
        `Current draft (JSON): ${JSON.stringify(draft)}`,
        `Feedback: "${text}"`,
        `Right now it is ${new Date().toString()}.`,
        "Apply the feedback by calling the recurringWorkPropose local tool with the SAME id and ALL fields (id, title, agentId, cron, timezone, instructions, approvalSummary, proposedToolPatterns), changing only what the feedback requires. Then reply with one short sentence stating exactly what changed. Do not ask questions.",
      ].join("\n"),
    });
  };

  return (
    <Dialog open={Boolean(work)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        {work ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">
                Approve recurring work
              </DialogTitle>
              <DialogDescription>
                Approve this once and {work.agentId} will keep running it until
                you pause or revoke it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="border p-4">
                <p className="text-sm font-medium">{work.title}</p>
                <p className="text-muted-foreground mt-2 text-sm leading-6">
                  {work.approvalSummary}
                </p>
                <p className="text-muted-foreground mt-3 font-mono text-[11px]">
                  {work.cron} · {work.timezone}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium">Delegated actions</p>
                <div className="mt-2 space-y-1.5">
                  {work.proposedToolPatterns.length > 0 ? (
                    work.proposedToolPatterns.map((pattern) => (
                      <div
                        key={pattern}
                        className="flex items-center gap-2 border px-3 py-2"
                      >
                        <ShieldCheck
                          size={13}
                          className="shrink-0 text-emerald-500"
                        />
                        <span className="min-w-0 truncate text-xs">
                          {pattern
                            .split(".")
                            .at(-1)
                            ?.replace(/([A-Z])/g, " $1")}
                        </span>
                        <span className="text-muted-foreground ml-auto max-w-56 truncate font-mono text-[9px]">
                          {pattern}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="text-muted-foreground border px-3 py-2 text-xs">
                      Read connected data and save no external changes.
                    </p>
                  )}
                </div>
              </div>
              <div className="border-t pt-3">
                <div className="flex gap-2">
                  <Input
                    value={feedback}
                    onChange={(event) => setFeedback(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        requestRevision();
                      }
                    }}
                    placeholder="Ask for a change before approving…"
                    disabled={busy}
                    className="h-8 text-sm"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={!feedback.trim() || busy}
                    onClick={requestRevision}
                  >
                    Send
                  </Button>
                </div>
                {busy ? (
                  <p className="agent-working mt-2 font-mono text-xs">
                    updating the plan…
                  </p>
                ) : revisionNote ? (
                  <p className="text-muted-foreground mt-2 text-xs leading-5">
                    {revisionNote}
                  </p>
                ) : null}
              </div>
            </div>
            <DialogFooter className="items-center">
              <button
                type="button"
                onClick={() => {
                  onReject(work);
                  onClose();
                }}
                className="text-muted-foreground hover:text-destructive mr-auto text-xs transition-colors"
              >
                Reject
              </button>
              <Button variant="outline" onClick={onClose}>
                Not now
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  onApprove(work);
                  onClose();
                }}
              >
                Approve and activate
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
