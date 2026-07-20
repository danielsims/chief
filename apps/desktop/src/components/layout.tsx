import { Outlet, useLocation } from "react-router";

import { TooltipProvider } from "@chief/ui/components/tooltip";
import { cn } from "@chief/ui/lib/utils";

import { useRuntime } from "../lib/runtime";
import { Sidebar } from "./sidebar";

function ConnectionDot() {
  const { status } = useRuntime();
  return (
    <div
      role="status"
      aria-label={`Runtime ${status}`}
      title={`Runtime ${status}`}
      className="flex h-6 items-center gap-2"
    >
      <span
        className={cn(
          "inline-block h-1.5 w-1.5",
          status === "connected" && "bg-emerald-500",
          status === "connecting" && "animate-pulse bg-blue-500",
          status === "disconnected" && "bg-destructive",
        )}
      />
      {status === "connecting" ? (
        <span className="text-muted-foreground font-mono text-[10px]">
          Connecting
        </span>
      ) : null}
    </div>
  );
}

export function Layout() {
  const location = useLocation();
  const overview = location.pathname === "/";

  return (
    <TooltipProvider>
      <div
        className={cn(
          "bg-background text-foreground",
          overview ? "h-screen overflow-hidden" : "min-h-screen",
        )}
      >
        <Sidebar />
        <div
          className={cn(
            "ml-[70px] flex flex-col",
            overview ? "h-screen overflow-hidden" : "min-h-screen",
          )}
        >
          {/* The controls sit above the drag strip so the rest of the header
              remains available as a native window drag target. */}
          <header className="relative h-12 shrink-0">
            <div data-tauri-drag-region className="absolute inset-0" />
            <div className="absolute inset-y-0 right-6 z-10 flex items-center">
              <ConnectionDot />
            </div>
          </header>
          <main
            className={cn(
              "flex-1 px-8 pb-8",
              overview && "chief-overview-layout-main min-h-0 overflow-hidden",
            )}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
