import { useSyncExternalStore } from "react";

let activeRelayWorkspaceId: string | null = null;
const listeners = new Set<() => void>();

export function setRelayWorkspaceOverride(workspaceId: string | null) {
  if (activeRelayWorkspaceId === workspaceId) return;
  activeRelayWorkspaceId = workspaceId;
  for (const listener of listeners) listener();
}

export function useRelayWorkspaceOverride() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => activeRelayWorkspaceId,
    () => null,
  );
}
