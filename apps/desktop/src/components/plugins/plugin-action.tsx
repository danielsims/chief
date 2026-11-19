import type { ReactNode } from "react";
import { Check, LoaderCircle } from "lucide-react";

import type { AgentPluginSummary } from "@chief/agent-runtime/types";
import { Button, buttonVariants } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

/** The raised pill used for a card's one action. */
export const pluginActionClassName =
  "raised-button relative min-w-[84px] cursor-pointer rounded-full px-4";

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
        buttonVariants({ variant: "outline", size: "xs" }),
        "text-muted-foreground pointer-events-none",
      )}
    >
      {tone === "connected" ? <Check size={12} /> : null}
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
      size="xs"
      className="relative"
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
          size={12}
        />
      ) : null}
    </Button>
  );
}
