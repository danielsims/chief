/**
 * Background app updates. A newer release is downloaded quietly as soon as it
 * is published; the sidebar only appears once it is ready, and installing is
 * a single restart. Nothing is installed without the person asking.
 */
export type AppUpdateStatus =
  | { state: "idle" }
  | { state: "downloading"; version: string }
  | { state: "ready"; version: string }
  | { state: "installing"; version: string }
  | { state: "failed"; version: string };

export interface DownloadableUpdate {
  version: string;
  download: () => Promise<void>;
  install: () => Promise<void>;
}

export interface AppUpdateDependencies {
  check: () => Promise<DownloadableUpdate | null>;
  relaunch: () => Promise<void>;
  warn: (message: string) => void;
}

export interface AppUpdateController {
  getStatus: () => AppUpdateStatus;
  subscribe: (listener: () => void) => () => void;
  /** Looks for a newer release and downloads it in the background. */
  refresh: () => Promise<void>;
  /** Installs the downloaded release and restarts Chief. */
  install: () => Promise<void>;
}

export function createAppUpdateController(
  dependencies: AppUpdateDependencies,
): AppUpdateController {
  let status: AppUpdateStatus = { state: "idle" };
  let staged: DownloadableUpdate | null = null;
  let refreshing: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const setStatus = (next: AppUpdateStatus) => {
    status = next;
    for (const listener of listeners) listener();
  };

  const download = async () => {
    const update = await dependencies.check();
    if (!update) return;
    setStatus({ state: "downloading", version: update.version });
    await update.download();
    staged = update;
    setStatus({ state: "ready", version: update.version });
  };

  const refresh = () => {
    // A staged or installing release stays put until Chief restarts.
    if (status.state === "ready" || status.state === "installing") {
      return Promise.resolve();
    }
    refreshing ??= download()
      .catch((error) => {
        // Checks and downloads retry on the next refresh; they never interrupt.
        dependencies.warn(
          `[Updater] Background update failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (status.state === "downloading") setStatus({ state: "idle" });
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  };

  const install = async () => {
    if (status.state !== "ready" && status.state !== "failed") return;
    if (!staged) {
      // A failed install drops its download; fetch a fresh copy first.
      setStatus({ state: "idle" });
      await refresh();
    }
    const update = staged;
    if (!update) return;
    setStatus({ state: "installing", version: update.version });
    try {
      await update.install();
      await dependencies.relaunch();
    } catch (error) {
      dependencies.warn(
        `[Updater] Install failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      staged = null;
      setStatus({ state: "failed", version: update.version });
    }
  };

  return {
    getStatus: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    install,
  };
}
