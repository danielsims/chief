import { Bell } from "lucide-react";
import { NavLink, Outlet } from "react-router";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@chief/ui/components/tooltip";
import { Sidebar } from "./sidebar";
import { useRuntime, useWorkspaceData } from "../lib/runtime";
import { useAuth } from "../lib/auth/auth-context";
import { cn } from "@chief/ui/lib/utils";

function ConnectionDot() {
  const { status } = useRuntime();
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span
        className={cn(
          "inline-block h-1.5 w-1.5",
          status === "connected" && "bg-emerald-500",
          status === "connecting" && "bg-amber-500",
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
              "relative flex size-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground",
              isActive && "bg-accent text-foreground",
            )
          }
        >
          <Bell size={14} />
          {attentionItems.length > 0 ? (
            <span className="absolute right-0 top-0 size-1.5 bg-amber-400" />
          ) : null}
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
      <div className="min-h-screen bg-background text-foreground">
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
