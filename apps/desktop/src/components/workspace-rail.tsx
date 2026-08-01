import { Home } from "lucide-react";
import { useLocation, useNavigate } from "react-router";

import { cn } from "@chief/ui/lib/utils";

import { WorkspaceSwitcher } from "./workspace-switcher";

export function WorkspaceRail() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav
      aria-label="Workspaces"
      className="bg-sidebar relative z-50 flex w-12 shrink-0 flex-col items-center pb-3"
    >
      <div className="h-10 shrink-0" data-tauri-drag-region />
      <WorkspaceSwitcher variant="rail" />
      <div className="bg-sidebar-border my-3 h-px w-5" />
      <button
        type="button"
        aria-label="Overview"
        onClick={() => navigate("/")}
        className={cn(
          "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-9 items-center justify-center rounded-2xl transition-all hover:rounded-xl",
          location.pathname === "/" &&
            "bg-sidebar-accent text-sidebar-foreground rounded-xl",
        )}
      >
        <Home size={15} />
      </button>
    </nav>
  );
}
