import { useEffect, useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

import type { AppUpdateStatus } from "./app-update";
import { createAppUpdateController } from "./app-update";

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const RESUME_CHECK_AGE_MS = 30 * 60 * 1000;

const updates = createAppUpdateController({
  check,
  relaunch,
  warn: (message) => console.warn(message),
});

let started = false;
let lastCheckedAt = 0;

function canCheckForUpdates() {
  return isTauri() && !import.meta.env.DEV;
}

function refresh() {
  lastCheckedAt = Date.now();
  void updates.refresh();
}

/** Starts background update checks once for the lifetime of the window. */
function startUpdateChecks() {
  if (started || !canCheckForUpdates()) return;
  started = true;
  refresh();
  window.setInterval(refresh, CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (
      document.visibilityState === "visible" &&
      Date.now() - lastCheckedAt >= RESUME_CHECK_AGE_MS
    ) {
      refresh();
    }
  });
}

export interface AppUpdate {
  status: AppUpdateStatus;
  install: () => void;
}

export function useAppUpdate(): AppUpdate {
  useEffect(startUpdateChecks, []);
  const status = useSyncExternalStore(
    updates.subscribe,
    updates.getStatus,
    updates.getStatus,
  );
  return { status, install: () => void updates.install() };
}
