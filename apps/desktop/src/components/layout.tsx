import { useCallback, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Outlet, useLocation } from "react-router";

import { TooltipProvider } from "@chief/ui/components/tooltip";
import { cn } from "@chief/ui/lib/utils";

import { useAuth } from "../lib/auth/auth-context";
import { AppTopChrome } from "./app-top-chrome";
import { SettingsSidebar } from "./settings-sidebar";
import { Sidebar } from "./sidebar";
import { WorkspaceContentSurface } from "./workspace-content-surface";
import { WorkspaceRail } from "./workspace-rail";

const DEFAULT_SIDEBAR_WIDTH = 300;
const MIN_SIDEBAR_WIDTH = 232;
const MAX_SIDEBAR_WIDTH = 380;

function readSidebarWidth() {
  const stored = Number(window.localStorage.getItem("chief:sidebar-width"));
  return Number.isFinite(stored)
    ? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, stored))
    : DEFAULT_SIDEBAR_WIDTH;
}

function readSidebarOpen() {
  return window.localStorage.getItem("chief:sidebar-open") !== "false";
}

export function Layout() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const overview = location.pathname === "/";
  const channel = location.pathname.startsWith("/conversations");
  const settings = location.pathname.startsWith("/settings");
  const reducedMotion = useReducedMotion();
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen);
  const [settingsSidebarOpen, setSettingsSidebarOpen] = useState(true);
  const activeSidebarOpen = settings ? settingsSidebarOpen : sidebarOpen;

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => {
      window.localStorage.setItem("chief:sidebar-open", String(!open));
      return !open;
    });
  }, []);
  const toggleSettingsSidebar = useCallback(() => {
    setSettingsSidebarOpen((open) => !open);
  }, []);

  const toggleActiveSidebar = settings ? toggleSettingsSidebar : toggleSidebar;

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
    <TooltipProvider delayDuration={250}>
      <div className="bg-sidebar text-foreground flex h-dvh overflow-hidden">
        <WorkspaceRail />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <AppTopChrome
            hasWorkspaceRail={isAuthenticated}
            sidebarOpen={activeSidebarOpen}
            onToggleSidebar={toggleActiveSidebar}
          />
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            {activeSidebarOpen ? (
              <div
                style={{ width: sidebarWidth }}
                className="relative h-full shrink-0 overflow-hidden transition-[width] duration-200"
              >
                <AnimatePresence initial={false} mode="wait">
                  <motion.div
                    key={settings ? "settings" : "workspace"}
                    initial={{ opacity: reducedMotion ? 1 : 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: reducedMotion ? 1 : 0 }}
                    transition={{ duration: reducedMotion ? 0 : 0.16 }}
                    className="absolute inset-0"
                  >
                    {settings ? (
                      <SettingsSidebar width={sidebarWidth} />
                    ) : (
                      <Sidebar
                        width={sidebarWidth}
                        onResizeStart={startSidebarResize}
                      />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            ) : null}
            <WorkspaceContentSurface balancedGutter={!activeSidebarOpen}>
              <div
                className={cn(
                  "min-h-0 min-w-0 flex-1",
                  settings
                    ? "overflow-y-auto"
                    : channel
                      ? "overflow-hidden"
                      : "overflow-y-auto px-8 pb-8",
                  overview && "overflow-hidden px-8 pb-8",
                )}
              >
                <Outlet />
              </div>
            </WorkspaceContentSurface>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
