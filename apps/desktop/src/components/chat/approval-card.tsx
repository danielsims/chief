import { ShieldQuestion } from "lucide-react";

import { Button } from "@chief/ui/components/button";

import type { PendingApproval } from "../../lib/runtime";
import { approvalPresentation } from "./approval-presentation";

/** An agent action that needs a clear, informed decision from the user. */
export function ApprovalCard({
  approval,
  onRespond,
  onAllowAll,
}: {
  approval: PendingApproval;
  onRespond: (requestId: string, behavior: "allow" | "deny") => void;
  onAllowAll?: () => void;
}) {
  const presentation = approvalPresentation(approval);
  return (
    <section className="bg-card/70 border-border/75 overflow-hidden rounded-xl border shadow-sm">
      <div className="px-4 py-3.5">
        <div className="flex items-start gap-3">
          <ShieldQuestion
            aria-hidden
            className="text-muted-foreground mt-0.5 shrink-0"
            size={17}
          />
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-[11px] font-medium">
              {presentation.eyebrow}
            </p>
            <h3 className="mt-0.5 text-sm font-medium tracking-[-0.01em]">
              {presentation.title}
            </h3>
            <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
              {presentation.description}
            </p>
          </div>
        </div>
        {presentation.detail ? (
          <div className="bg-muted/35 border-border/60 mt-3 rounded-lg border px-3 py-2.5">
            <p className="text-muted-foreground mb-1.5 text-[10px] font-medium">
              {presentation.detailLabel}
            </p>
            <pre className="text-foreground/85 max-h-32 overflow-auto font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap">
              {presentation.detail}
            </pre>
          </div>
        ) : null}
      </div>
      <div className="bg-muted/15 border-border/60 flex flex-wrap items-center justify-end gap-2 border-t px-4 py-2.5">
        {onAllowAll ? (
          <button
            type="button"
            onClick={onAllowAll}
            className="text-muted-foreground hover:text-foreground cursor-pointer text-xs transition-colors"
          >
            Allow the rest
          </button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 rounded-lg px-2.5 text-xs"
          onClick={() => onRespond(approval.requestId, "deny")}
        >
          {presentation.denyLabel}
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 rounded-lg px-2.5 text-xs"
          onClick={() => onRespond(approval.requestId, "allow")}
        >
          {presentation.allowLabel}
        </Button>
      </div>
    </section>
  );
}
