import {
  listAuthOrganizations,
  parseOrganizationMetadata,
} from "./auth/better-auth-client";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The brand brief gathered during account setup, rendered as compact
 * markdown. Sent with every openSession so agents start primed with who the
 * business is instead of interviewing the user about it.
 */
export async function buildWorkspaceContext(
  workspaceId: string | null,
): Promise<string | undefined> {
  if (!workspaceId) return undefined;
  const organizations = await listAuthOrganizations();
  const org =
    organizations.find((candidate) => candidate.id === workspaceId) ??
    organizations[0];
  if (!org) return undefined;

  const metadata = parseOrganizationMetadata(org);
  const onboarding = record(metadata.onboarding);
  const goals = record(onboarding.goals);
  const ads = record(onboarding.ads);
  const monitoring = record(onboarding.monitoring);
  const analytics = record(onboarding.analytics);

  const lines: string[] = [];
  const website = text(metadata.websiteUrl);
  lines.push(`Company: ${org.name}${website ? ` (${website})` : ""}`);
  const selling = text(goals.selling);
  if (selling) lines.push(`What they sell: ${selling}`);
  const audience = text(goals.audience);
  if (audience) lines.push(`Ideal customer: ${audience}`);
  const success = text(goals.success);
  if (success) lines.push(`Success looks like: ${success}`);
  const timeBudget = text(goals.timeBudget);
  if (timeBudget) lines.push(`Time the user can spend on marketing: ${timeBudget}`);
  const budget = text(ads.budget);
  if (budget) lines.push(`Paid ads: ${budget}`);
  const channels = Array.isArray(monitoring.channels)
    ? monitoring.channels.filter((c): c is string => typeof c === "string")
    : [];
  if (channels.length > 0) {
    lines.push(`Channels being watched: ${channels.join(", ")}`);
  }
  const integrations = Array.isArray(analytics.integrations)
    ? analytics.integrations
        .map((item) => text(record(item).name))
        .filter(Boolean)
    : [];
  if (integrations.length > 0) {
    lines.push(`Analytics sources chosen at setup: ${integrations.join(", ")}`);
  }

  return lines.join("\n");
}
