import { LoaderCircle } from "lucide-react";

import { Button } from "@chief/ui/components/button";

import type { AppUpdate } from "../lib/updater";

/**
 * Floats over the bottom of the sidebar once a downloaded update is ready. It
 * overlays the channel list instead of taking space from it; the sidebar pads
 * its list so every row can still be scrolled clear of the card.
 */
export function SidebarUpdateCard({ update }: { update: AppUpdate }) {
  const { status, install } = update;
  if (status.state === "idle" || status.state === "downloading") return null;

  const installing = status.state === "installing";
  const failed = status.state === "failed";
  return (
    <div className="pointer-events-none relative h-0">
      <div className="bg-sidebar border-sidebar-border pointer-events-auto absolute inset-x-2.5 bottom-1 flex items-center gap-3 rounded-xl border py-2.5 pr-2.5 pl-3.5 shadow-[0_6px_20px_rgba(0,0,0,0.1)] dark:shadow-[0_6px_20px_rgba(0,0,0,0.4)]">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-4 font-semibold">
            {failed ? "Update didn't install" : "Update ready"}
          </span>
          <span className="text-sidebar-muted block truncate text-[12px] leading-4">
            Chief {status.version}
          </span>
        </span>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={installing}
          onClick={install}
          aria-label={
            failed
              ? `Try installing Chief ${status.version} again`
              : `Restart to update to Chief ${status.version}`
          }
          className="px-2.5"
        >
          {installing ? (
            <LoaderCircle className="animate-spin" size={13} />
          ) : failed ? (
            "Try again"
          ) : (
            "Restart"
          )}
        </Button>
      </div>
    </div>
  );
}
