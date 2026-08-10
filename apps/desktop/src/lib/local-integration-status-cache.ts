import type { LocalIntegrationStatus } from "@chief/agent-runtime/types";

const cache = new Map<string, LocalIntegrationStatus[]>();

function storageKey(workspaceId: string) {
  return `chief:local-integration-status:${workspaceId}`;
}

function isIntegrationStatus(value: unknown): value is LocalIntegrationStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as Partial<LocalIntegrationStatus>;
  return (
    typeof status.provider === "string" && typeof status.status === "string"
  );
}

export function cachedLocalIntegrationStatus(workspaceId: string) {
  const cached = cache.get(workspaceId);
  if (cached) return cached;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(storageKey(workspaceId)) ?? "null",
    ) as LocalIntegrationStatus[] | null;
    if (!Array.isArray(stored)) return null;
    const valid = stored.filter(isIntegrationStatus);
    cache.set(workspaceId, valid);
    return valid;
  } catch {
    return null;
  }
}

export function primeLocalIntegrationStatus(
  workspaceId: string,
  integrations: LocalIntegrationStatus[],
) {
  cache.set(workspaceId, integrations);
  window.localStorage.setItem(
    storageKey(workspaceId),
    JSON.stringify(integrations),
  );
}
