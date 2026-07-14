import { Bell } from "lucide-react";
import { NavLink, Outlet } from "react-router";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@chief/ui/components/tooltip";
import { cn } from "@chief/ui/lib/utils";

import { useAuth } from "../lib/auth/auth-context";
import { useRuntime, useWorkspaceData } from "../lib/runtime";
import { Sidebar } from "./sidebar";

function ConnectionDot() {
  const { status } = useRuntime();
  return (
    <div className="text-muted-foreground flex items-center gap-2 text-[11px]">
      <span
        className={cn(
          "inline-block h-1.5 w-1.5",
          status === "connected" && "bg-emerald-500",
          status === "connecting" && "animate-pulse bg-blue-500",
          status === "disconnected" && "bg-destructive",
        )}
      />
      {status === "connected" ? "runtime" : status}
    </div>
  );
}

function HistoryButton() {
  const { cloudOrganizationId } = useAuth();
  const { attentionItems } = useWorkspaceData(cloudOrganizationId);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          to="/schedule/history"
          aria-label="Notifications and run history"
          className={({ isActive }) =>
            cn(
              "text-muted-foreground hover:text-foreground relative flex size-7 items-center justify-center transition-colors",
              isActive && "bg-accent text-foreground",
            )
          }
        >
          <span className="relative inline-flex">
            <Bell size={14} />
            {attentionItems.length > 0 ? (
              <span className="absolute -top-0.5 -right-0.5 size-1.5 bg-amber-400" />
            ) : null}
          </span>
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Notifications and run history
      </TooltipContent>
    </Tooltip>
  );
}

export function Layout() {
  return (
    <TooltipProvider>
      <div className="bg-background text-foreground min-h-screen">
        <Sidebar />
        <div className="ml-[70px] flex min-h-screen flex-col">
          {/* The controls sit above the drag strip so the rest of the header
              remains available as a native window drag target. */}
          <header className="relative h-12 shrink-0">
            <div data-tauri-drag-region className="absolute inset-0" />
            <div className="absolute inset-y-0 right-6 z-10 flex items-center gap-4">
              <HistoryButton />
              <ConnectionDot />
            </div>
          </header>
          <main className="flex-1 px-8 pb-8">
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
