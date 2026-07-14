import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
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

export function navigateApp(route: string) {
  window.history.pushState({}, "", route);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** macOS-level notification; silently a no-op outside Tauri or if denied. */
export async function notifySystem(
  title: string,
  body?: string,
  route?: string,
) {
  if (!isTauri()) return;
  try {
    if (await ensurePermission()) {
      // Tauri's desktop notification plugin uses the Web Notification API.
      // Keeping the instance lets us handle the system notification click.
      const notification = new Notification(title, { body: body ?? "" });
      if (route) {
        notification.onclick = () => {
          notification.close();
          void (async () => {
            const appWindow = getCurrentWindow();
            await appWindow.unminimize();
            await appWindow.show();
            await appWindow.setFocus();
            navigateApp(route);
          })();
        };
      }
    }
  } catch {
    // A notification must never break the app.
  }
}
