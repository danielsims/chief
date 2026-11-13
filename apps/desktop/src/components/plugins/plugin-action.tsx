import { LoaderCircle } from "lucide-react";

import type { AgentPluginSummary } from "@chief/agent-runtime/types";
import { Button, buttonVariants } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

const actionClassName = "relative min-w-[84px] rounded-full px-4";

/**
 * One pill for every plugin: Install until it works, then its state. A plugin
 * that was added but never signed in still just needs installing.
 */
export function PluginAction({
  plugin,
  busy,
  canManage,
  onInstall,
  onAuthorize,
}: {
  plugin: AgentPluginSummary;
  busy: boolean;
  /** Owners and admins install plugins; members use installed ones. */
  canManage: boolean;
  onInstall: () => void;
  onAuthorize: () => void;
}) {
  if (plugin.status === "connected" || plugin.status === "installed") {
    return (
      <span
        className={cn(
          buttonVariants({ variant: "secondary", size: "sm" }),
          actionClassName,
          "pointer-events-none",
          plugin.status === "connected"
            ? "text-emerald-500"
            : "text-muted-foreground",
        )}
      >
        {plugin.status === "connected" ? "Connected" : "Installed"}
      </span>
    );
  }
  if (!canManage)
    return (
      <span
        className={cn(
          buttonVariants({ variant: "secondary", size: "sm" }),
          actionClassName,
          "text-muted-foreground pointer-events-none",
        )}
      >
        Ask an admin
      </span>
    );
  const label = plugin.status === "reconnect" ? "Reconnect" : "Install";
  return (
    <Button
      variant="secondary"
      size="sm"
      className={actionClassName}
      disabled={busy}
      onClick={
        plugin.status === "available" || plugin.status === "error"
          ? onInstall
          : onAuthorize
      }
    >
      <span className={cn(busy && "invisible")}>{label}</span>
      {busy ? (
        <LoaderCircle
          className="absolute inset-0 m-auto animate-spin"
          size={14}
        />
      ) : null}
    </Button>
  );
}
