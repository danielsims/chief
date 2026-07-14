import { useCallback, useEffect, useRef, useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@chief/ui/components/tooltip";

import type { AvailableUpdate, UpdateProgress } from "../lib/updater";
import {
  canCheckForUpdates,
  checkForUpdate,
  installUpdate,
} from "../lib/updater";

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const RESUME_CHECK_AGE_MS = 30 * 60 * 1000;

function progressLabel(progress: UpdateProgress | null) {
  if (!progress) return "Install update";
  if (progress.phase === "installing") return "Installing update";
  if (!progress.total) return "Downloading update";

  const percent = Math.min(
    100,
    Math.round((progress.downloaded / progress.total) * 100),
  );
  return `Downloading update ${percent}%`;
}

export function UpdateAvailable() {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const lastCheckedAt = useRef(0);
  const notifiedVersion = useRef<string | null>(null);
  const installing = useRef(false);

  const startInstall = useCallback(async () => {
    if (installing.current) return;
    installing.current = true;
    setProgress({ downloaded: 0, total: null, phase: "downloading" });
    const toastId = toast.loading("Downloading the Chief update...");

    try {
      await installUpdate(setProgress);
    } catch (error) {
      console.error("[Updater] Install failed:", error);
      installing.current = false;
      setProgress(null);
      toast.error("Chief could not install the update.", {
        id: toastId,
        description: "Check your connection, then try again.",
      });
    }
  }, []);

  const runCheck = useCallback(async () => {
    lastCheckedAt.current = Date.now();
    try {
      const result = await checkForUpdate();
      setUpdate(result);

      if (result && notifiedVersion.current !== result.version) {
        notifiedVersion.current = result.version;
        toast(`Chief ${result.version} is ready`, {
          description: "Update and relaunch without leaving the app.",
          action: {
            label: "Update",
            onClick: () => void startInstall(),
          },
        });
      }
    } catch (error) {
      // Update checks should never interrupt the product. A later interval or
      // foreground event will retry automatically.
      console.warn("[Updater] Check failed:", error);
    }
  }, [startInstall]);

  useEffect(() => {
    if (!canCheckForUpdates()) return;

    void runCheck();
    const interval = window.setInterval(
      () => void runCheck(),
      CHECK_INTERVAL_MS,
    );
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastCheckedAt.current >= RESUME_CHECK_AGE_MS
      ) {
        void runCheck();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [runCheck]);

  if (!update) return null;

  const label = progressLabel(progress);
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => void startInstall()}
          disabled={progress !== null}
          aria-label={`${label}. Chief ${update.version} is available.`}
          className="border-border bg-accent text-foreground hover:bg-foreground hover:text-background relative flex h-10 w-10 items-center justify-center border transition-colors disabled:cursor-wait"
        >
          {progress ? (
            <LoaderCircle
              className="animate-spin"
              size={17}
              strokeWidth={1.75}
            />
          ) : (
            <Download size={17} strokeWidth={1.75} />
          )}
          <span className="border-background bg-foreground absolute -top-1 -right-1 h-2 w-2 border" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {label}. Chief {update.version} is available.
      </TooltipContent>
    </Tooltip>
  );
}
