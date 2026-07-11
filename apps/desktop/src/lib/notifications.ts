import { isTauri } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

// One permission round-trip per app session, resolved lazily on first use.
let permission: Promise<boolean> | null = null;

function ensurePermission(): Promise<boolean> {
  permission ??= (async () => {
    try {
      if (await isPermissionGranted()) return true;
      return (await requestPermission()) === "granted";
    } catch {
      return false;
    }
  })();
  return permission;
}

/** macOS-level notification; silently a no-op outside Tauri or if denied. */
export async function notifySystem(title: string, body?: string) {
  if (!isTauri()) return;
  try {
    if (await ensurePermission()) {
      sendNotification({ title, body: body ?? "" });
    }
  } catch {
    // A notification must never break the app.
  }
}
