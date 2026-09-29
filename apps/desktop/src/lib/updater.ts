import { useEffect, useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

import type { AppUpdateStatus } from "./app-update";
import { createAppUpdateController } from "./app-update";

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const RESUME_CHECK_AGE_MS = 30 * 60 * 1000;

// Development only: `VITE_CHIEF_FAKE_UPDATE=0.9.0 pnpm dev` stages a pretend
// release so the sidebar card can be reviewed without publishing one.
const FAKE_UPDATE_VERSION = import.meta.env.DEV
  ? import.meta.env.VITE_CHIEF_FAKE_UPDATE
  : undefined;

const updates = createAppUpdateController({
  check: FAKE_UPDATE_VERSION
    ? () =>
        Promise.resolve({
          version: FAKE_UPDATE_VERSION,
          download: () => Promise.resolve(),
          install: () => Promise.resolve(),
        })
    : check,
  relaunch: FAKE_UPDATE_VERSION ? () => Promise.resolve() : relaunch,
  warn: (message) => console.warn(message),
});

let started = false;
let lastCheckedAt = 0;

function canCheckForUpdates() {
  return Boolean(FAKE_UPDATE_VERSION) || (isTauri() && !import.meta.env.DEV);
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

export function useAppUpdate(): {
  status: AppUpdateStatus;
  install: () => void;
} {
  useEffect(startUpdateChecks, []);
  const status = useSyncExternalStore(
    updates.subscribe,
    updates.getStatus,
    updates.getStatus,
  );
  return { status, install: () => void updates.install() };
}
