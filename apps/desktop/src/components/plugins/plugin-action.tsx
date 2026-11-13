import type { ReactNode } from "react";
import { Check, LoaderCircle } from "lucide-react";

import type { AgentPluginSummary } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

const actionClassName = "raised-button relative min-w-[84px] rounded-full px-4";

/** A state rather than a button, so it never looks clickable. */
function PluginState({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "connected" | "muted";
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-[84px] items-center justify-center gap-1.5 px-4 text-[13px] font-medium",
        tone === "connected" ? "text-emerald-600" : "text-muted-foreground",
      )}
    >
      {tone === "connected" ? <Check size={14} strokeWidth={2.25} /> : null}
      {children}
    </span>
  );
}

/**
 * Install until it works, then its state. A plugin that was added but never
 * signed in still just needs installing.
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
  if (plugin.status === "connected")
    return <PluginState tone="connected">Connected</PluginState>;
  if (plugin.status === "installed")
    return <PluginState tone="muted">Installed</PluginState>;
  if (!canManage) return <PluginState tone="muted">Ask an admin</PluginState>;
  const label = plugin.status === "reconnect" ? "Reconnect" : "Install";
  return (
    <Button
      variant="outline"
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
