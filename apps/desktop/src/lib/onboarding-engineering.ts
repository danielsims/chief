import type {
  ActionItem,
  LocalIntegrationStatus,
} from "@chief/agent-runtime/types";

import type { CatalogIntegration } from "./integration-catalog";
import { ENGINEERING_INTEGRATIONS } from "./integration-catalog";

const ACTION_PREFIX = "onboarding-engineering-";

interface OrganizationWithMetadata {
  metadata?: string | Record<string, unknown> | null;
}

function organizationMetadata(organization: OrganizationWithMetadata) {
  if (!organization.metadata) return {};
  if (typeof organization.metadata === "object") return organization.metadata;
  try {
    const parsed: unknown = JSON.parse(organization.metadata);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function selectedIntegrations(organization: OrganizationWithMetadata | null) {
  if (!organization) return [];
  const metadata = organizationMetadata(organization);
  const onboarding = metadata.onboarding;
  if (!onboarding || typeof onboarding !== "object") return [];
  const engineering = (onboarding as Record<string, unknown>).engineering;
  if (!engineering || typeof engineering !== "object") return [];
  const record = engineering as Record<string, unknown>;
  if (record.enabled !== true || !Array.isArray(record.integrations)) return [];
  const domains = new Set(
    record.integrations.flatMap((integration) =>
      integration !== null &&
      typeof integration === "object" &&
      typeof (integration as Record<string, unknown>).domain === "string"
        ? [(integration as Record<string, string>).domain]
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
  if (!onboarding || typeof onboarding !== "object") return false;
  const analytics = (onboarding as Record<string, unknown>).analytics;
  if (!analytics || typeof analytics !== "object") return false;
  const integrations = (analytics as Record<string, unknown>).integrations;
  return (
    Array.isArray(integrations) &&
    integrations.some(
      (integration) =>
        integration !== null &&
        typeof integration === "object" &&
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
      title: "Set up engineering tools",
      reason:
        remaining.length === 1
          ? `Connect ${nextIntegration.name} so Chief can prepare approved technical growth changes in your workspace.`
          : `Connect ${nextIntegration.name} next, then Chief will continue with ${remaining
              .slice(1)
              .map((integration) => integration.name)
              .join(" and ")}.`,
      status: "open",
      createdAt: 0,
    },
  };
}
