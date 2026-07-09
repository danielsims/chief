import { Outlet } from "react-router";
import { TooltipProvider } from "@marketer/ui/components/tooltip";
import { Sidebar } from "./sidebar";
import { useRuntime } from "../lib/runtime";
import { cn } from "@marketer/ui/lib/utils";

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

export function Layout() {
  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground">
        <Sidebar />
        <div className="ml-[70px] flex min-h-screen flex-col">
          {/* Empty drag strip; the status dot is a non-interactive overlay so
              mousedown anywhere in the header hits the drag element. */}
          <header className="relative h-12 shrink-0">
            <div data-tauri-drag-region className="absolute inset-0" />
            <div className="pointer-events-none absolute inset-y-0 right-6 flex items-center">
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
