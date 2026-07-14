import { Button } from "@chief/ui/components/button";

import type { PendingApproval } from "../../lib/runtime";
import { toolSummary } from "./message-blocks";

/**
 * An agent tool call waiting on the user's decision. Reads and probes never
 * reach this card (the runtime's approval policy auto-allows them); what
 * shows here is a mutation of the machine or the outside world.
 */
export function ApprovalCard({
  approval,
  onRespond,
  onAllowAll,
}: {
  approval: PendingApproval;
  onRespond: (requestId: string, behavior: "allow" | "deny") => void;
  onAllowAll?: () => void;
}) {
  return (
    <div className="bg-background border">
      <div className="bg-accent/50 text-muted-foreground flex items-baseline gap-2 border-b px-3 py-1.5 font-mono text-xs">
        <span className="text-foreground">?</span>
        <span className="shrink-0">{approval.toolName}</span>
        <span className="truncate">{toolSummary(approval.input)}</span>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <p className="text-muted-foreground text-xs">
          The agent wants to run this.
        </p>
        <div className="flex items-center gap-2">
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
            className="h-6 px-2 text-xs"
            onClick={() => onRespond(approval.requestId, "deny")}
          >
            Deny
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => onRespond(approval.requestId, "allow")}
          >
            Allow
          </Button>
        </div>
      </div>
    </div>
  );
}
