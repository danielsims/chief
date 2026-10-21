import { ChevronsLeft, ChevronsRight, FileText, Table2, X } from "lucide-react";
import { useSearchParams } from "react-router";

import { cn } from "@chief/ui/lib/utils";

import type { ChannelTab } from "./channel-tabs";
import { useAuth } from "../../lib/auth/auth-context";
import { useWorkspaceFiles } from "../../lib/runtime";
import { useDatabases, usePrefetchDatabase } from "../databases/use-database";
import { useChannelTabs } from "./channel-tabs";

export type ChannelView = "messages" | "artifacts";

const tabClass =
  "text-muted-foreground hover:text-foreground relative flex h-full shrink-0 items-center gap-1.5 px-2.5 text-[12px] leading-4 font-normal transition-colors";

function Underline() {
  return (
    <span className="bg-foreground absolute right-2.5 bottom-0 left-2.5 h-px" />
  );
}

/**
 * A channel's views: its messages, its artifacts, and each artifact opened
 * from them, kept as a tab until it's closed. Artifact tabs can be folded
 * away to keep the bar short.
 */
export function ChannelViewTabs({
  channelId,
  activeView,
  onViewChange,
}: {
  channelId: string;
  activeView: ChannelView;
  onViewChange: (view: ChannelView) => void;
}) {
  const [params, setParams] = useSearchParams();
  const { cloudOrganizationId } = useAuth();
  const { files } = useWorkspaceFiles(cloudOrganizationId);
  const { databases } = useDatabases(channelId);
  const prefetch = usePrefetchDatabase();
  const fileId = params.get("artifact");
  const databaseId = params.get("database");
  const active: ChannelTab | undefined =
    activeView !== "artifacts"
      ? undefined
      : fileId
        ? { kind: "file", id: fileId }
        : databaseId
          ? { kind: "database", id: databaseId }
          : undefined;
  const { tabs, collapsed, setCollapsed, close } = useChannelTabs(
    channelId,
    active,
  );
  const isActive = (tab: ChannelTab) =>
    active?.kind === tab.kind && active.id === tab.id;
  const labelled = tabs.flatMap((tab) => {
    if (tab.kind === "file") {
      const file = files.find((candidate) => candidate.id === tab.id);
      // A file from another channel, or one that's gone, isn't offered.
      if (files.length && file?.sourceConversationId !== channelId) return [];
      return [{ tab, name: file?.name ?? "Artifact", icon: FileText }];
    }
    const database = databases.find((candidate) => candidate.id === tab.id);
    if (!database && !isActive(tab)) return [];
    return [
      {
        tab,
        name: database?.name ?? "Database",
        icon: Table2,
      },
    ];
  });
  const shown = collapsed
    ? labelled.filter(({ tab }) => isActive(tab))
    : labelled;

  const open = (tab: ChannelTab | null) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const key of [
        "activity",
        "child",
        "profile",
        "artifact",
        "database",
      ])
        next.delete(key);
      next.set("view", "artifacts");
      if (tab) next.set(tab.kind === "file" ? "artifact" : "database", tab.id);
      return next;
    });

  return (
    <nav
      aria-label="Channel views"
      className="flex h-10 items-stretch gap-1 overflow-x-auto px-5"
    >
      {(
        [
          { id: "messages", label: "Messages" },
          { id: "artifacts", label: "Artifacts" },
        ] as const
      ).map((view) => {
        const selected = activeView === view.id && !active;
        return (
          <button
            key={view.id}
            type="button"
            onClick={() => onViewChange(view.id)}
            className={cn(tabClass, selected && "text-foreground")}
          >
            {view.label}
            {selected ? <Underline /> : null}
          </button>
        );
      })}
      {labelled.length ? (
        <span aria-hidden className="bg-border/80 my-3 w-px shrink-0" />
      ) : null}
      {shown.map(({ tab, name, icon: Icon }) => {
        const selected = isActive(tab);
        return (
          <div
            key={`${tab.kind}:${tab.id}`}
            className={cn(
              "group/tab relative flex shrink-0 items-center",
              selected && "text-foreground",
            )}
          >
            <button
              type="button"
              onClick={() => open(tab)}
              onPointerEnter={() => {
                if (tab.kind === "database") prefetch(tab.id);
              }}
              className={cn(tabClass, "pr-1", selected && "text-foreground")}
            >
              <Icon size={12} className="shrink-0" />
              <span className="max-w-44 truncate">{name}</span>
            </button>
            <button
              type="button"
              aria-label={`Close ${name}`}
              title="Close"
              onClick={() => {
                close(tab);
                if (selected) open(null);
              }}
              className={cn(
                "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] mr-1 flex size-4 items-center justify-center rounded opacity-0 transition-opacity group-hover/tab:opacity-100 focus-visible:opacity-100",
                selected && "opacity-100",
              )}
            >
              <X size={10} />
            </button>
            {selected ? <Underline /> : null}
          </div>
        );
      })}
      {labelled.length > 1 || (collapsed && labelled.length) ? (
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={
            collapsed ? "Show artifact tabs" : "Collapse artifact tabs"
          }
          title={collapsed ? "Show artifact tabs" : "Collapse artifact tabs"}
          className={cn(tabClass, "px-1.5")}
        >
          {collapsed ? (
            <>
              <ChevronsRight size={13} />
              {labelled.length > shown.length ? (
                <span className="tabular-nums">
                  {labelled.length - shown.length}
                </span>
              ) : null}
            </>
          ) : (
            <ChevronsLeft size={13} />
          )}
        </button>
      ) : null}
    </nav>
  );
}
