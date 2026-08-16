import { useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCw,
} from "lucide-react";

import { cn } from "@chief/ui/lib/utils";

import { useRuntime } from "../lib/runtime";
import { useNavigationHistory } from "./use-navigation-history";

const controlClass =
  "flex size-7 items-center justify-center rounded-md text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:pointer-events-none disabled:opacity-25";

export function AppTopChrome({
  sidebarOpen,
  onToggleSidebar,
  hasWorkspaceRail,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  hasWorkspaceRail: boolean;
}) {
  const { canGoBack, canGoForward, goBack, goForward } = useNavigationHistory();
  const { client, status } = useRuntime();
  const [recovering, setRecovering] = useState(false);

  const recoverRuntime = async () => {
    setRecovering(true);
    try {
      if (isTauri()) await invoke("restart_agent_runtime");
    } finally {
      client.reconnectNow();
      window.setTimeout(() => setRecovering(false), 5_000);
    }
  };

  return (
    <header
      className={cn(
        "bg-sidebar relative z-40 flex h-10 shrink-0 items-center pr-3",
        hasWorkspaceRail ? "pl-8" : "pl-20",
      )}
      data-tauri-drag-region
    >
      <div className="relative z-10 flex translate-y-[3px] items-center gap-0.5">
        <button
          type="button"
          aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          onClick={onToggleSidebar}
          className={controlClass}
        >
          {sidebarOpen ? (
            <PanelLeftClose size={16} />
          ) : (
            <PanelLeftOpen size={16} />
          )}
        </button>
        <button
          type="button"
          aria-label="Go back"
          disabled={!canGoBack}
          onClick={goBack}
          className={cn(controlClass, "w-6")}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          aria-label="Go forward"
          disabled={!canGoForward}
          onClick={goForward}
          className={cn(controlClass, "w-6")}
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div
        id="chief-app-status"
        className="ml-auto flex items-center gap-1.5"
      />
      {status === "disconnected" ? (
        <button
          type="button"
          className="text-foreground/80 hover:text-foreground flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors hover:bg-red-500/10"
          onClick={() => void recoverRuntime()}
          title="Restart the local runtime"
        >
          <span className="size-1.5 rounded-full bg-red-500" />
          {recovering ? <RotateCw className="animate-spin" size={12} /> : null}
          {recovering ? "Restarting runtime…" : "Runtime disconnected · Retry"}
        </button>
      ) : null}
    </header>
  );
}
