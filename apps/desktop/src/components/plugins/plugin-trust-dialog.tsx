import type { AgentPluginSummary } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";

export function PluginTrustDialog({
  plugin,
  open,
  onOpenChange,
  onConfirm,
}: {
  plugin: AgentPluginSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>Add {plugin?.name ?? "plugin"}?</DialogTitle>
          <DialogDescription className="leading-5">
            This installs a pinned third-party package and enables its portable
            skills and MCP servers for agents in this workspace. Review the
            source before trusting it.
          </DialogDescription>
        </DialogHeader>
        {plugin?.repository ? (
          <p className="bg-muted text-muted-foreground truncate rounded-lg px-3 py-2 font-mono text-[11px]">
            {plugin.repository}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Add plugin</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
