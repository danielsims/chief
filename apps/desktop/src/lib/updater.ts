import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

export interface AvailableUpdate {
  version: string;
  body?: string;
  date?: string;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
  phase: "downloading" | "installing";
}

let availableUpdate: Update | null = null;
let activeCheck: Promise<AvailableUpdate | null> | null = null;
let activeInstall: Promise<void> | null = null;

export function canCheckForUpdates() {
  return isTauri() && !import.meta.env.DEV;
}

export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!canCheckForUpdates()) return null;
  if (activeCheck) return activeCheck;

  activeCheck = check()
    .then((update) => {
      availableUpdate = update;
      if (!update) return null;

      return {
        version: update.version,
        body: update.body ?? undefined,
        date: update.date ?? undefined,
      };
    })
    .finally(() => {
      activeCheck = null;
    });

  return activeCheck;
}

export async function installUpdate(
  onProgress?: (progress: UpdateProgress) => void,
): Promise<void> {
  if (activeInstall) return activeInstall;

  activeInstall = (async () => {
    const update = availableUpdate ?? (await check());
    if (!update) throw new Error("The update is no longer available.");

    let downloaded = 0;
    let total: number | null = null;

    await update.downloadAndInstall((event: DownloadEvent) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? null;
        onProgress?.({ downloaded: 0, total, phase: "downloading" });
        return;
      }

      if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        onProgress?.({ downloaded, total, phase: "downloading" });
        return;
      }

      onProgress?.({ downloaded, total, phase: "installing" });
    });

    await relaunch();
  })().finally(() => {
    activeInstall = null;
  });

  return activeInstall;
}
