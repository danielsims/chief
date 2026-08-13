import { useSyncExternalStore } from "react";
import { play } from "cuelume";

import type { ChannelEvent } from "@chief/agent-runtime/types";

import { observedChannelMessage } from "./channel-read-state";

export const NOTIFICATION_SOUNDS = [
  "chime",
  "sparkle",
  "droplet",
  "bloom",
  "ready",
  "success",
] as const;

export type NotificationSound = (typeof NOTIFICATION_SOUNDS)[number];

export interface NotificationSoundPreferences {
  desktopEnabled: boolean;
  enabled: boolean;
  sound: NotificationSound;
}

const STORAGE_KEY = "chief:notification-sounds:v1";
const DEFAULT_PREFERENCES: NotificationSoundPreferences = {
  desktopEnabled: true,
  enabled: true,
  sound: "chime",
};

let cachedPreferences: NotificationSoundPreferences | null = null;
const listeners = new Set<() => void>();

export function isNotificationSound(
  value: unknown,
): value is NotificationSound {
  return NOTIFICATION_SOUNDS.some((sound) => sound === value);
}

export function parseNotificationSoundPreferences(
  value: unknown,
): NotificationSoundPreferences {
  if (!value || typeof value !== "object") return DEFAULT_PREFERENCES;
  const candidate = value as Partial<NotificationSoundPreferences>;
  return {
    desktopEnabled:
      typeof candidate.desktopEnabled === "boolean"
        ? candidate.desktopEnabled
        : DEFAULT_PREFERENCES.desktopEnabled,
    enabled:
      typeof candidate.enabled === "boolean"
        ? candidate.enabled
        : DEFAULT_PREFERENCES.enabled,
    sound: isNotificationSound(candidate.sound)
      ? candidate.sound
      : DEFAULT_PREFERENCES.sound,
  };
}

function readPreferences() {
  if (cachedPreferences) return cachedPreferences;
  try {
    cachedPreferences = parseNotificationSoundPreferences(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as unknown,
    );
  } catch {
    cachedPreferences = DEFAULT_PREFERENCES;
  }
  return cachedPreferences;
}

function writePreferences(next: NotificationSoundPreferences) {
  cachedPreferences = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A failed local preference write must never interrupt the app.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNotificationSoundPreferences() {
  const preferences = useSyncExternalStore(
    subscribe,
    readPreferences,
    () => DEFAULT_PREFERENCES,
  );

  return {
    preferences,
    setDesktopEnabled: (desktopEnabled: boolean) =>
      writePreferences({ ...readPreferences(), desktopEnabled }),
    setEnabled: (enabled: boolean) =>
      writePreferences({ ...readPreferences(), enabled }),
    setSound: (sound: NotificationSound) =>
      writePreferences({ ...readPreferences(), sound }),
  };
}

export function desktopNotificationsEnabled() {
  return readPreferences().desktopEnabled;
}

export function notificationSoundsEnabled() {
  return readPreferences().enabled;
}

export function previewNotificationSound(sound: NotificationSound) {
  play(sound, { volume: 0.78 });
}

export function shouldPlayChannelNotification(event: ChannelEvent) {
  return observedChannelMessage(event) !== null;
}

export function playConfiguredNotificationSound() {
  const preferences = readPreferences();
  if (!preferences.enabled) return;
  try {
    play(preferences.sound, { volume: 0.78 });
  } catch {
    // Audio is best effort; notification delivery must never fail because a
    // browser/WebView audio context is unavailable or still locked.
  }
}
