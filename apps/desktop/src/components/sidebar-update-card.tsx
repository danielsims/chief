import { ArrowDownToLine, LoaderCircle } from "lucide-react";

import { Button } from "@chief/ui/components/button";

import { useAppUpdate } from "../lib/updater";

/**
 * Floats above the sidebar footer once a downloaded update is ready. It
 * overlays the channel list rather than resizing it, so appearing never shifts
 * anything the person is looking at.
 */
export function SidebarUpdateCard() {
  const { status, install } = useAppUpdate();
  if (
    status.state !== "ready" &&
    status.state !== "installing" &&
    status.state !== "failed"
  ) {
    return null;
  }

  const installing = status.state === "installing";
  const failed = status.state === "failed";
  return (
    <div className="pointer-events-none relative h-0">
      <div className="bg-sidebar border-sidebar-border pointer-events-auto absolute inset-x-2.5 bottom-1 rounded-xl border p-3 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
        <div className="flex items-center gap-2.5">
          <span className="bg-sidebar-accent flex size-7 shrink-0 items-center justify-center rounded-full">
            <ArrowDownToLine size={14} strokeWidth={1.75} />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] leading-4 font-semibold">
              {failed ? "Update failed" : "Update ready"}
            </span>
            <span className="text-sidebar-muted block truncate text-[12px] leading-4">
              {failed ? "Chief couldn't install it" : `Chief ${status.version}`}
            </span>
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={installing}
          onClick={install}
          className="mt-2.5 w-full"
        >
          {installing ? (
            <>
              <LoaderCircle className="animate-spin" size={14} />
              Restarting…
            </>
          ) : failed ? (
            "Try again"
          ) : (
            "Restart to update"
          )}
        </Button>
      </div>
    </div>
  );
}
