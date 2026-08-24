import type { LocalIntegrationStatus } from "@chief/agent-runtime/types";
import type { JsonValue } from "@chief/relay-contracts";
import {
  isJsonObject,
  isJsonString,
  parseJsonValue,
} from "@chief/relay-contracts";

const cache = new Map<string, LocalIntegrationStatus[]>();

function storageKey(workspaceId: string) {
  return `chief:local-integration-status:${workspaceId}`;
}

function integrationStatus(value: JsonValue): LocalIntegrationStatus | null {
  if (!isJsonObject(value)) return null;
  const status = value;
  if (
    !isJsonString(status.provider) ||
    !isJsonString(status.category) ||
    (status.status !== "connected" &&
      status.status !== "needs-authorization" &&
      status.status !== "unavailable")
  ) {
    return null;
  }
  const integration: LocalIntegrationStatus = {
    provider: status.provider,
    category: status.category,
    status: status.status,
  };
  if (isJsonString(status.displayName)) {
    integration.displayName = status.displayName;
  }
  if (isJsonString(status.externalId))
    integration.externalId = status.externalId;
  if (status.needsCredentials === true) integration.needsCredentials = true;
  return integration;
}

export function cachedLocalIntegrationStatus(workspaceId: string) {
  const cached = cache.get(workspaceId);
  if (cached) return cached;
  try {
    const stored = parseJsonValue(
      JSON.parse(
        window.localStorage.getItem(storageKey(workspaceId)) ?? "null",
      ),
    );
    if (!Array.isArray(stored)) return null;
    const valid = stored.flatMap((value) => {
      const integration = integrationStatus(value);
      return integration ? [integration] : [];
    });
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
