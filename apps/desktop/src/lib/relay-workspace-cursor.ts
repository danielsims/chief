function storageKey(workspaceId: string) {
  return `chief.relay.workspace-cursor.${workspaceId}`;
}

export function loadWorkspaceCursor(workspaceId: string) {
  try {
    const value = globalThis.localStorage.getItem(storageKey(workspaceId));
    if (value === null) return undefined;
    const cursor = Number(value);
    return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : undefined;
  } catch {
    return undefined;
  }
}

export function saveWorkspaceCursor(
  workspaceId: string,
  cursor: number | undefined,
) {
  if (cursor === undefined || !Number.isSafeInteger(cursor) || cursor < 0)
    return;
  try {
    globalThis.localStorage.setItem(storageKey(workspaceId), String(cursor));
  } catch {
    // Live delivery remains correct for this session when storage is unavailable.
  }
}
