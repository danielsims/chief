import {
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

import { cn } from "@chief/ui/lib/utils";

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

  return (
    <header
      className={cn(
        "bg-sidebar relative z-40 flex h-10 shrink-0 translate-y-[3px] items-center pr-3",
        hasWorkspaceRail ? "pl-8" : "pl-20",
      )}
      data-tauri-drag-region
    >
      <div className="relative z-10 flex items-center gap-0.5">
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
    </header>
  );
}
