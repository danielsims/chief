import type {
  ActionItem,
  LocalIntegrationStatus,
} from "@chief/agent-runtime/types";
import { isJsonObject, isJsonString } from "@chief/relay-contracts";

import type { CatalogIntegration } from "./integration-catalog";
import { ENGINEERING_INTEGRATIONS } from "./integration-catalog";

const ACTION_PREFIX = "onboarding-engineering-";

interface OrganizationWithMetadata {
  metadata?: string | Record<string, unknown> | null;
}

function organizationMetadata(organization: OrganizationWithMetadata) {
  const metadata = organization.metadata;
  if (!metadata) return {};
  if (isJsonObject(metadata)) return metadata;
  if (!isJsonString(metadata)) return {};
  try {
    const parsed: unknown = JSON.parse(metadata);
    return parsed && isJsonObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function selectedIntegrations(organization: OrganizationWithMetadata | null) {
  if (!organization) return [];
  const metadata = organizationMetadata(organization);
  const onboarding = metadata.onboarding;
  if (!onboarding || !isJsonObject(onboarding)) return [];
  const engineering = onboarding.engineering;
  if (!engineering || !isJsonObject(engineering)) return [];
  if (engineering.enabled !== true || !Array.isArray(engineering.integrations))
    return [];
  const domains = new Set(
    engineering.integrations.flatMap((integration) =>
      integration !== null &&
      isJsonObject(integration) &&
      isJsonString(integration.domain)
        ? [integration.domain]
        : [],
    ),
  );
  return ENGINEERING_INTEGRATIONS.filter((integration) =>
    domains.has(integration.domain),
  );
}

function isConnected(
  integration: CatalogIntegration,
  connected: LocalIntegrationStatus[],
) {
  return connected.some(
    (item) =>
      item.status === "connected" &&
      (item.provider === integration.provider ||
        item.provider === integration.domain),
  );
}

export function isOnboardingEngineeringAction(action: ActionItem) {
  return action.id.startsWith(ACTION_PREFIX);
}

export function selectedGoogleAnalyticsDuringOnboarding(
  organization: OrganizationWithMetadata | null,
) {
  if (!organization) return false;
  const onboarding = organizationMetadata(organization).onboarding;
  if (!onboarding || !isJsonObject(onboarding)) return false;
  const analytics = (onboarding as Record<string, unknown>).analytics;
  if (!analytics || !isJsonObject(analytics)) return false;
  const integrations = (analytics as Record<string, unknown>).integrations;
  return (
    Array.isArray(integrations) &&
    integrations.some(
      (integration) =>
        integration !== null &&
        isJsonObject(integration) &&
        (integration as Record<string, unknown>).domain ===
          "analytics.googleapis.com",
    )
  );
}

export function onboardingEngineeringSetup(
  workspaceId: string | null,
  organization: OrganizationWithMetadata | null,
  connected: LocalIntegrationStatus[] | null,
): { nextIntegration?: CatalogIntegration; action?: ActionItem } {
  if (!workspaceId || connected === null) return {};
  const remaining = selectedIntegrations(organization).filter(
    (integration) => !isConnected(integration, connected),
  );
  const nextIntegration = remaining[0];
  if (!nextIntegration) return {};
  return {
    nextIntegration,
    action: {
      id: `${ACTION_PREFIX}${workspaceId}`,
      agentId: "setup",
      title: "Connect engineering tools",
      reason:
        remaining.length === 1
          ? `Connect ${nextIntegration.name} so Chief can prepare approved website and code changes.`
          : `Connect ${nextIntegration.name} next, then Chief will continue with ${remaining
              .slice(1)
              .map((integration) => integration.name)
              .join(" and ")}.`,
      status: "open",
      createdAt: 0,
    },
  };
}
