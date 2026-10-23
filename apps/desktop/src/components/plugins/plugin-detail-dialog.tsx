import { useState } from "react";
import { ChevronRight, LoaderCircle } from "lucide-react";

import type {
  AgentPluginSummary,
  AgentPluginTool,
} from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { cn } from "@chief/ui/lib/utils";

import { pluginDomain } from "../../lib/plugin-presentation";
import { ProviderLogo } from "../provider-logo";

function toolLabel(tool: AgentPluginTool) {
  if (tool.title) return tool.title;
  const words = tool.name
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return words.charAt(0).toLocaleUpperCase() + words.slice(1);
}

function statusLine(plugin: AgentPluginSummary) {
  switch (plugin.status) {
    case "connected":
      return { tone: "bg-emerald-500", label: "Connected" };
    case "waiting":
      return { tone: "bg-amber-500", label: "Waiting for you to sign in" };
    case "authorization_required":
      return { tone: "bg-amber-500", label: "Needs sign-in" };
    case "reconnect":
      return { tone: "bg-amber-500", label: "Sign in again to keep using it" };
    case "failed":
    case "error":
      return {
        tone: "bg-destructive",
        label: plugin.diagnostics?.at(-1) ?? "Couldn't connect",
      };
    case "installed":
      return { tone: "bg-emerald-500", label: "Added" };
    default:
      return null;
  }
}

function ToolGroup({
  label,
  tools,
}: {
  label: string;
  tools: AgentPluginTool[];
}) {
  const [open, setOpen] = useState(false);
  if (tools.length === 0) return null;
  return (
    <div className="border-border/60 border-b last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="hover:bg-accent/40 flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] transition-colors"
      >
        {label}
        <span className="text-muted-foreground font-normal tabular-nums">
          {tools.length}
        </span>
        <ChevronRight
          size={14}
          className={cn(
            "text-muted-foreground ml-auto transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open ? (
        <ul className="max-h-64 space-y-3 overflow-y-auto px-3.5 pt-0.5 pb-3.5">
          {tools.map((tool) => (
            <li key={tool.name} className="min-w-0">
              <p className="truncate text-xs font-medium">{toolLabel(tool)}</p>
              {tool.description ? (
                <p className="text-muted-foreground mt-0.5 line-clamp-2 text-[11px] leading-4">
                  {tool.description}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function PluginDetailDialog({
  plugin,
  busy,
  onClose,
  onAdd,
  onConnect,
  onRemove,
}: {
  plugin: AgentPluginSummary | null;
  busy: boolean;
  onClose: () => void;
  onAdd: (plugin: AgentPluginSummary) => void;
  onConnect: (plugin: AgentPluginSummary) => void;
  onRemove: (plugin: AgentPluginSummary) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const tools = plugin?.connection?.tools ?? [];
  const writes = tools.filter((tool) => !tool.readOnly);
  const reads = tools.filter((tool) => tool.readOnly);
  const status = plugin ? statusLine(plugin) : null;
  const added = plugin && plugin.status !== "available";
  const connectLabel =
    plugin?.status === "waiting"
      ? "Reopen sign-in"
      : plugin?.status === "failed" || plugin?.status === "error"
        ? "Try again"
        : plugin?.status === "reconnect"
          ? "Reconnect"
          : "Connect";

  return (
    <Dialog
      open={Boolean(plugin)}
      onOpenChange={(open) => {
        if (open) return;
        setExpanded(false);
        onClose();
      }}
    >
      <DialogContent className="border-border/80 w-[calc(100%-32px)] max-w-[460px] gap-0 overflow-hidden rounded-2xl p-0 shadow-[0_16px_64px_-12px_rgb(0_0_0/0.45)]">
        {plugin ? (
          <>
            <DialogHeader className="space-y-0 px-6 pt-6 pr-12 pb-5 text-left">
              <ProviderLogo
                domain={pluginDomain(plugin)}
                label={plugin.name}
                className="mb-4 size-12 rounded-[14px]"
              />
              <DialogTitle className="flex items-baseline gap-2 text-[19px] leading-6 font-semibold tracking-[-0.02em]">
                {plugin.name}
                <span className="text-muted-foreground text-[15px] font-normal">
                  Plugin
                </span>
              </DialogTitle>
              <DialogDescription
                className={cn(
                  "text-foreground/80 mt-2 text-[13px] leading-5",
                  !expanded && "line-clamp-4",
                )}
              >
                {plugin.description}
              </DialogDescription>
              {plugin.description.length > 240 ? (
                <button
                  type="button"
                  onClick={() => setExpanded((value) => !value)}
                  className="text-muted-foreground hover:text-foreground mt-1 self-start text-xs transition-colors"
                >
                  {expanded ? "Show less" : "Show more"}
                </button>
              ) : null}
            </DialogHeader>

            <div className="space-y-3 px-6 pb-6">
              {status ? (
                <p className="text-muted-foreground flex min-w-0 items-center gap-2 text-[13px]">
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      status.tone,
                    )}
                  />
                  <span className="truncate">{status.label}</span>
                  {plugin.connection ? (
                    <span className="text-muted-foreground/70 ml-auto shrink-0 truncate">
                      {new URL(plugin.connection.url).hostname}
                    </span>
                  ) : null}
                </p>
              ) : null}
              {tools.length > 0 ? (
                <>
                  <p className="text-muted-foreground text-[13px]">
                    {plugin.name} has {tools.length}{" "}
                    {tools.length === 1 ? "tool" : "tools"} ({writes.length}{" "}
                    write, {reads.length} read)
                  </p>
                  <div className="bg-foreground/[0.025] overflow-hidden rounded-xl shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
                    <ToolGroup label="Write" tools={writes} />
                    <ToolGroup label="Read" tools={reads} />
                  </div>
                </>
              ) : plugin.connection && plugin.status === "connected" ? (
                <p className="text-muted-foreground text-xs">
                  This server doesn't offer any tools yet.
                </p>
              ) : plugin.source.type === "discovery" ? (
                <p className="text-muted-foreground text-xs">
                  Connect it to see what your agents can do with it.
                </p>
              ) : null}
            </div>

            <DialogFooter className="border-border/60 items-center border-t px-4 py-3">
              {added &&
              plugin.status !== "connected" &&
              plugin.status !== "installed" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground mr-auto rounded-md text-xs"
                  onClick={() => onRemove(plugin)}
                >
                  Remove
                </Button>
              ) : (
                <span className="mr-auto" />
              )}
              {busy ? (
                <span className="text-muted-foreground flex items-center gap-1.5 px-2 text-xs">
                  <LoaderCircle className="animate-spin" size={13} /> Working…
                </span>
              ) : plugin.status === "available" ? (
                <Button
                  size="sm"
                  className="rounded-md text-xs"
                  onClick={() => onAdd(plugin)}
                >
                  Add plugin
                </Button>
              ) : plugin.status === "connected" ||
                plugin.status === "installed" ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-md text-xs"
                  onClick={() => onRemove(plugin)}
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="rounded-md text-xs"
                  onClick={() => onConnect(plugin)}
                >
                  {connectLabel}
                </Button>
              )}
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
