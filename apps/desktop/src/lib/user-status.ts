import { useCallback, useSyncExternalStore } from "react";

export interface UserStatus {
  emoji: string;
  text: string;
}

const statusCache = new Map<string, UserStatus | null>();
const statusListeners = new Map<string, Set<() => void>>();

function storageKey(workspaceId: string | null, userId: string | null) {
  return `chief:user-status:${workspaceId ?? "local"}:${userId ?? "user"}`;
}

function readStatus(key: string) {
  if (statusCache.has(key)) return statusCache.get(key) ?? null;
  try {
    const value = JSON.parse(
      window.localStorage.getItem(key) ?? "null",
    ) as unknown;
    const status =
      value &&
      typeof value === "object" &&
      typeof (value as Partial<UserStatus>).text === "string" &&
      typeof (value as Partial<UserStatus>).emoji === "string"
        ? (value as UserStatus)
        : null;
    statusCache.set(key, status);
    return status;
  } catch {
    statusCache.set(key, null);
    return null;
  }
}

function subscribeStatus(key: string, listener: () => void) {
  const listeners = statusListeners.get(key) ?? new Set<() => void>();
  listeners.add(listener);
  statusListeners.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) statusListeners.delete(key);
  };
}

function writeStatus(key: string, status: UserStatus | null) {
  if (status) window.localStorage.setItem(key, JSON.stringify(status));
  else window.localStorage.removeItem(key);
  statusCache.set(key, status);
  statusListeners.get(key)?.forEach((listener) => listener());
}

export function useUserStatus(
  workspaceId: string | null,
  userId: string | null,
) {
  const key = storageKey(workspaceId, userId);
  const subscribe = useCallback(
    (listener: () => void) => subscribeStatus(key, listener),
    [key],
  );
  const getSnapshot = useCallback(() => readStatus(key), [key]);
  const status = useSyncExternalStore(subscribe, getSnapshot, () => null);

  return {
    status,
    clearStatus: () => writeStatus(key, null),
    setStatus: (next: UserStatus) => writeStatus(key, next),
  };
}
