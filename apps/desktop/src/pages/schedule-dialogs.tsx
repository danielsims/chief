import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";

import type { ScheduledDraft } from "./schedule-calendar-core";

export function ScheduleDraftDialog({
  draft,
  onClose,
  onOpenDraft,
}: {
  draft: ScheduledDraft | null;
  onClose: () => void;
  onOpenDraft: (draft: ScheduledDraft) => void;
}) {
  const content = (draft?.body ?? "").trim();
  const status = draft
    ? draft.status[0]?.toUpperCase() + draft.status.slice(1)
    : "";
  const timing = draft?.scheduledFor
    ? new Date(draft.scheduledFor).toLocaleString([], {
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Awaiting a time";

  return (
    <Dialog open={Boolean(draft)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="border-border/80 w-[calc(100%-32px)] max-w-[480px] gap-0 overflow-hidden rounded-xl p-0 shadow-[0_16px_64px_-12px_rgb(0_0_0/0.45)]">
        {draft ? (
          <>
            <DialogHeader className="space-y-1 px-5 pt-5 pr-12 pb-4 text-left">
              <DialogTitle className="text-[17px] leading-6 font-medium tracking-tight">
                {draft.title}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {draft.platform}
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
                    <span className="bg-muted-foreground/50 size-1.5 rounded-full" />
                    {status}
                  </dd>
                </div>
              </dl>
            </div>
            {draft.fileId ? (
              <DialogFooter className="border-border/60 items-center border-t px-4 py-3">
                <Button
                  size="sm"
                  className="rounded-md text-xs"
                  onClick={() => onOpenDraft(draft)}
                >
                  Open draft
                </Button>
              </DialogFooter>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
