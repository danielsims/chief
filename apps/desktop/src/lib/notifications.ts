import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";

import type { JsonValue } from "@chief/relay-contracts";
import { isJsonObject, isJsonString } from "@chief/relay-contracts";

import type { MessageNavigationTarget } from "./app-navigation";
import {
  chiefDeepLinkUrl,
  dispatchChiefNavigation,
  messageDestination,
} from "./app-navigation";
import {
  claimConfiguredNotificationSound,
  desktopNotificationsEnabled,
  notificationSoundsEnabled,
  playNotificationSound,
} from "./notification-sounds";

export type DesktopNotificationTarget =
  | {
      kind: "message";
      deepLinkUrl: string;
      message: MessageNavigationTarget;
    }
  | { kind: "route"; route: string };

export interface DesktopNotificationEnvironment {
  bundled: boolean;
  nativePermissionChecks: boolean;
  authorizationStatus?:
    | "notDetermined"
    | "denied"
    | "authorized"
    | "provisional"
    | "ephemeral"
    | "unknown"
    | null;
  alertsEnabled?: boolean | null;
  soundsEnabled?: boolean | null;
  notificationCenterEnabled?: boolean | null;
}

export interface DesktopNotificationTestResult {
  delivered: boolean;
  environment: DesktopNotificationEnvironment | null;
  error?: string;
}

// Only deduplicate an in-flight permission prompt. Do not cache a denied
// result forever: macOS users can grant the permission in System Settings
// while Chief remains open.
let permissionRequest: Promise<boolean> | null = null;
let actionListener: Promise<void> | null = null;
let pendingActivationDrain: Promise<void> | null = null;
const NATIVE_NOTIFICATION_ACTION = "chief-notification-activated";

function activateTarget(target: JsonValue | DesktopNotificationTarget) {
  if (isJsonString(target)) {
    navigateApp(target);
  } else if (isJsonObject(target)) {
    const candidate = target;
    if (candidate.kind === "route" && isJsonString(candidate.route)) {
      navigateApp(candidate.route);
    } else if (
      candidate.kind === "message" &&
      isJsonObject(candidate.message) &&
      isJsonString(candidate.message.channelId) &&
      isJsonString(candidate.message.messageId)
    ) {
      const message: MessageNavigationTarget = {
        channelId: candidate.message.channelId,
        messageId: candidate.message.messageId,
      };
      if (isJsonString(candidate.message.channelSlug)) {
        message.channelSlug = candidate.message.channelSlug;
      }
      if (isJsonString(candidate.message.directAgentId)) {
        message.directAgentId = candidate.message.directAgentId;
      }
      if (isJsonString(candidate.message.threadRootId)) {
        message.threadRootId = candidate.message.threadRootId;
      }
      dispatchChiefNavigation(messageDestination(message));
    } else {
      return;
    }
  } else {
    return;
  }
  // The route is the durable outcome of a notification click. Window state
  // operations are best-effort and must never prevent React Router from seeing
  // the destination (for example, `unminimize` can reject for a visible window).
  void (async () => {
    const appWindow = getCurrentWindow();
    await Promise.allSettled([
      appWindow.unminimize(),
      appWindow.show(),
      appWindow.setFocus(),
    ]);
  })();
}

function drainPendingActivation() {
  if (!isTauri()) return Promise.resolve();
  pendingActivationDrain ??= invoke<JsonValue | null>(
    "take_pending_notification_activation",
  )
    .then((target) => activateTarget(target))
    .catch(() => undefined)
    .finally(() => {
      pendingActivationDrain = null;
    });
  return pendingActivationDrain;
}

function ensureActionListener() {
  actionListener ??= listen(NATIVE_NOTIFICATION_ACTION, () => {
    void drainPendingActivation();
  }).then(async () => {
    window.addEventListener("focus", () => {
      void drainPendingActivation();
    });
    await drainPendingActivation();
  });
  return actionListener;
}

function showWebNotification(
  title: string,
  body: string,
  target?: DesktopNotificationTarget,
) {
  const notification = new window.Notification(title, { body, silent: true });
  if (target) {
    notification.onclick = () => {
      notification.close();
      activateTarget(target);
    };
  }
}

function hasNotificationApi() {
  return "Notification" in window;
}

function ensurePermission(): Promise<boolean> {
  // In a Tauri build the plugin owns the native permission state. WebKit's
  // Notification.permission can be `default` (or stale `denied`) even when
  // macOS has granted the signed app permission, so do not gate the native
  // check on the WebView value.
  if (isTauri()) {
    permissionRequest ??= (async () => {
      try {
        const environment = await desktopNotificationEnvironment();
        if (environment?.nativePermissionChecks) {
          return await invoke<boolean>(
            "request_native_notification_permission",
          );
        }
        if (await isPermissionGranted()) return true;
        return (await requestPermission()) === "granted";
      } catch {
        return false;
      }
    })().finally(() => {
      permissionRequest = null;
    });
    return permissionRequest;
  }

  if (!hasNotificationApi()) return Promise.resolve(false);
  if (window.Notification.permission === "granted")
    return Promise.resolve(true);
  if (window.Notification.permission === "denied")
    return Promise.resolve(false);
  permissionRequest ??= (async () => {
    try {
      return (await requestPermission()) === "granted";
    } catch {
      return false;
    }
  })().finally(() => {
    permissionRequest = null;
  });
  return permissionRequest;
}

export function navigateApp(route: string) {
  window.history.pushState({}, "", route);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export async function requestDesktopNotificationAccess() {
  return ensurePermission();
}

export async function desktopNotificationEnvironment() {
  if (!isTauri()) return null;
  try {
    return await invoke<DesktopNotificationEnvironment>(
      "notification_environment",
    );
  } catch {
    return null;
  }
}

export async function testDesktopNotification(): Promise<DesktopNotificationTestResult> {
  let environment = await desktopNotificationEnvironment();
  if (!(await ensurePermission())) {
    return {
      delivered: false,
      environment,
      error: "macOS notification permission is not granted.",
    };
  }
  environment = await desktopNotificationEnvironment();
  if (environment?.alertsEnabled === false) {
    return {
      delivered: false,
      environment,
      error: "macOS banners are disabled for Chief in System Settings.",
    };
  }
  try {
    if (isTauri()) {
      await invoke("show_native_notification", {
        title: "Chief notifications are working",
        body: "You’ll see messages and handoffs here when you’re away.",
        target: null,
        sound: notificationSoundsEnabled(),
      });
    } else if (hasNotificationApi()) {
      showWebNotification(
        "Chief notifications are working",
        "You’ll see messages and handoffs here when you’re away.",
      );
    } else {
      throw new Error("This environment does not support notifications.");
    }
    return { delivered: true, environment };
  } catch (error) {
    return {
      delivered: false,
      environment,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function syncDesktopUnreadBadge(count: number) {
  if (!isTauri()) return;
  try {
    const appWindow = getCurrentWindow();
    await appWindow.setBadgeCount(count > 0 ? count : undefined);
    if (count === 0) await appWindow.setBadgeLabel("");
  } catch {
    // Dock badges are best-effort on unsupported desktop environments.
  }
}

/**
 * Delivers one silent OS banner and Chief's configured sound as one event.
 *
 * Signed macOS builds use the native UNUserNotificationCenter path. The
 * Tauri notification plugin remains a fallback for other desktop platforms
 * and carries the same click-through route in its action payload.
 */
export async function notifySystem(
  title: string,
  body?: string,
  target?: DesktopNotificationTarget,
  options?: { urgent?: boolean },
) {
  const claimedSound = claimConfiguredNotificationSound();
  let delivered = false;
  let nativeSoundDelivered = false;
  try {
    if (desktopNotificationsEnabled() && (await ensurePermission())) {
      if (isTauri()) await ensureActionListener();
      if (isTauri()) {
        try {
          nativeSoundDelivered =
            claimedSound !== null &&
            (Boolean(options?.urgent) ||
              document.visibilityState !== "visible" ||
              !document.hasFocus());
          await invoke("show_native_notification", {
            title,
            body: body ?? "",
            target: target ?? null,
            sound: nativeSoundDelivered,
          });
        } catch {
          nativeSoundDelivered = false;
          showWebNotification(title, body ?? "", target);
        }
      } else {
        showWebNotification(title, body ?? "", target);
      }
      delivered = true;
      if (isTauri() && (!document.hasFocus() || options?.urgent)) {
        await getCurrentWindow().requestUserAttention(
          UserAttentionType.Informational,
        );
      }
    }
  } catch {
    // A notification must never break the app.
  }
  if (!nativeSoundDelivered && claimedSound) {
    playNotificationSound(claimedSound);
  }
  return delivered;
}

export function messageNotificationTarget(
  message: MessageNavigationTarget,
): DesktopNotificationTarget {
  return {
    kind: "message",
    deepLinkUrl: chiefDeepLinkUrl(messageDestination(message)),
    message,
  };
}
