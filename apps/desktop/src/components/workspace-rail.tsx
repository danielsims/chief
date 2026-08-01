import { Home } from "lucide-react";
import { useNavigate } from "react-router";

import { cn } from "@chief/ui/lib/utils";

import { useRuntime } from "../lib/runtime";
import { ChiefMark } from "./chief-mark";
import { WorkspaceSwitcher } from "./workspace-switcher";

export function WorkspaceRail() {
  const navigate = useNavigate();
  const { status } = useRuntime();

  return (
    <nav
      aria-label="Workspaces"
      className="bg-sidebar relative z-50 flex w-12 shrink-0 flex-col items-center pb-3"
    >
      <div className="h-10 shrink-0" data-tauri-drag-region />
      <button
        type="button"
        aria-label="Chief overview"
        onClick={() => navigate("/")}
        className="group bg-foreground text-background relative flex size-9 items-center justify-center rounded-2xl transition-all hover:rounded-xl"
      >
        <ChiefMark className="size-[18px]" />
        <span className="sr-only">Chief</span>
      </button>
      <div className="bg-sidebar-border my-3 h-px w-5" />
      <button
        type="button"
        aria-label="Overview"
        onClick={() => navigate("/")}
        className="bg-sidebar-accent/70 text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-9 items-center justify-center rounded-2xl transition-all hover:rounded-xl"
      >
        <Home size={15} />
      </button>
      <div className="mt-auto flex flex-col items-center gap-3">
        <span
          aria-label={`Runtime ${status}`}
          className={cn(
            "ring-sidebar size-2 rounded-full ring-2",
            status === "connected" && "bg-emerald-500",
            status === "connecting" && "animate-pulse bg-amber-400",
            status === "disconnected" && "bg-destructive",
          )}
        />
        <WorkspaceSwitcher variant="rail" />
      </div>
    </nav>
  );
}
