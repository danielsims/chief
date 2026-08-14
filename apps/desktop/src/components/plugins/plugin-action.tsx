import { Check, CircleAlert, LoaderCircle, RotateCw } from "lucide-react";

import type { AgentPluginSummary } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";

const actionClassName = "rounded-full px-4";

export function PluginAction({
  plugin,
  busy,
  onInstall,
  onAuthorize,
}: {
  plugin: AgentPluginSummary;
  busy: boolean;
  onInstall: () => void;
  onAuthorize: () => void;
}) {
  if (busy) {
    return (
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <LoaderCircle className="animate-spin" size={13} /> Installing…
      </span>
    );
  }
  if (plugin.status === "connected") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-emerald-500">
        <Check size={13} /> Connected
      </span>
    );
  }
  if (plugin.status === "waiting") {
    return (
      <Button
        variant="secondary"
        size="sm"
        className={actionClassName}
        onClick={onAuthorize}
      >
        Reopen
      </Button>
    );
  }
  if (plugin.status === "failed") {
    return (
      <Button
        variant="secondary"
        size="sm"
        className={actionClassName}
        onClick={onAuthorize}
      >
        <CircleAlert size={13} /> Retry
      </Button>
    );
  }
  if (plugin.status === "reconnect") {
    return (
      <Button
        variant="secondary"
        size="sm"
        className={actionClassName}
        onClick={onAuthorize}
      >
        <RotateCw size={13} /> Reconnect
      </Button>
    );
  }
  if (plugin.status === "authorization_required") {
    return (
      <Button
        variant="secondary"
        size="sm"
        className={actionClassName}
        onClick={onAuthorize}
      >
        Authorize
      </Button>
    );
  }
  if (plugin.status === "installed") {
    return (
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Check size={13} /> Added
      </span>
    );
  }
  if (plugin.status === "error") {
    return (
      <Button
        variant="secondary"
        size="sm"
        className={actionClassName}
        onClick={onInstall}
      >
        Retry
      </Button>
    );
  }
  return (
    <Button
      variant="secondary"
      size="sm"
      className={actionClassName}
      onClick={onInstall}
    >
      Add
    </Button>
  );
}
