import { Button } from "@marketer/ui/components/button";
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
    <div className="border bg-background">
      <div className="flex items-baseline gap-2 border-b bg-accent/50 px-3 py-1.5 font-mono text-xs text-muted-foreground">
        <span className="text-foreground">?</span>
        <span className="shrink-0">{approval.toolName}</span>
        <span className="truncate">{toolSummary(approval.input)}</span>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <p className="text-xs text-muted-foreground">
          The agent wants to run this.
        </p>
        <div className="flex items-center gap-2">
          {onAllowAll ? (
            <button
              type="button"
              onClick={onAllowAll}
              className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground"
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
