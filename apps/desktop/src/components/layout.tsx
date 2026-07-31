import { useState } from "react";
import { Outlet, useLocation } from "react-router";

import { TooltipProvider } from "@chief/ui/components/tooltip";
import { cn } from "@chief/ui/lib/utils";

import { Sidebar } from "./sidebar";

const DEFAULT_SIDEBAR_WIDTH = 272;
const MIN_SIDEBAR_WIDTH = 232;
const MAX_SIDEBAR_WIDTH = 360;

export function Layout() {
  const location = useLocation();
  const overview = location.pathname === "/";
  const channel = location.pathname.startsWith("/conversations");
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem("chief:sidebar-width"));
    return Number.isFinite(stored)
      ? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, stored))
      : DEFAULT_SIDEBAR_WIDTH;
  });

  const startSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const move = (moveEvent: PointerEvent) => {
      setSidebarWidth(
        Math.min(
          MAX_SIDEBAR_WIDTH,
          Math.max(MIN_SIDEBAR_WIDTH, startWidth + moveEvent.clientX - startX),
        ),
      );
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setSidebarWidth((value) => {
        window.localStorage.setItem("chief:sidebar-width", String(value));
        return value;
      });
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  return (
    <TooltipProvider>
      <div
        className={cn(
          "bg-background text-foreground",
          overview ? "h-screen overflow-hidden" : "min-h-screen",
        )}
      >
        <Sidebar width={sidebarWidth} onResizeStart={startSidebarResize} />
        <div
          style={{ marginLeft: sidebarWidth }}
          className={cn(
            "flex flex-col",
            overview ? "h-screen overflow-hidden" : "min-h-screen",
          )}
        >
          {/* The controls sit above the drag strip so the rest of the header
              remains available as a native window drag target. */}
          <header
            className={cn(
              "relative h-12 shrink-0 border-b",
              channel && "hidden",
            )}
          >
            <div data-tauri-drag-region className="absolute inset-0" />
          </header>
          <main
            className={cn(
              "flex-1 px-8 pb-8",
              overview && "chief-overview-layout-main min-h-0 overflow-hidden",
              channel && "min-h-0 overflow-hidden p-0",
            )}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
