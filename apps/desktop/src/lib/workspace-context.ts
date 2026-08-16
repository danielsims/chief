import type { AuthOrganization } from "./auth/better-auth-client";
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
 * markdown. Sent whenever Chief opens a root chat so work starts primed with who the
 * business is instead of interviewing the user about it.
 */
export function workspaceContextFromOrganization(
  org: AuthOrganization | null | undefined,
): string | undefined {
  if (!org) return undefined;
  const metadata = parseOrganizationMetadata(org);
  const onboarding = record(metadata.onboarding);
  const goals = record(onboarding.goals);
  const ads = record(onboarding.ads);
  const aeo = record(onboarding.aeo);
  const monitoring = record(onboarding.monitoring);
  const plugins = record(onboarding.plugins);
  const analytics = record(onboarding.analytics);
  const automation = record(onboarding.automation);
  const brand = record(onboarding.brand);

  const lines: string[] = [];
  const website = text(metadata.websiteUrl);
  lines.push(`Company: ${org.name}${website ? ` (${website})` : ""}`);
  lines.push(
    "Discovery is progressive: setup intentionally did not ask for positioning, audience, brand voice, public accounts, prospect sources, success criteria, or recurring work. Research first. When one missing answer would materially change the work, the relevant specialist should ask one compact structured question in its owning channel, then continue from the answer. Do not turn missing optional context into an intake questionnaire.",
  );
  const selling = text(goals.selling);
  if (selling) lines.push(`What they sell: ${selling}`);
  const audience = text(goals.audience);
  if (audience) lines.push(`Ideal customer: ${audience}`);
  const success = Array.isArray(goals.success)
    ? goals.success
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .join(", ")
    : text(goals.success);
  if (success) lines.push(`Success looks like: ${success}`);
  const brandNotes = text(brand.notes);
  if (brandNotes) lines.push(`Brand notes from onboarding: ${brandNotes}`);
  const timeBudget = text(goals.timeBudget);
  if (timeBudget)
    lines.push(`Time the user can spend on marketing: ${timeBudget}`);
  const budget = text(ads.budget);
  if (budget) lines.push(`Paid ads: ${budget}`);
  const adIntegrations = Array.isArray(ads.integrations)
    ? ads.integrations.map((item) => text(record(item).name)).filter(Boolean)
    : [];
  if (adIntegrations.length > 0) {
    lines.push(`Ad accounts chosen at setup: ${adIntegrations.join(", ")}`);
  }
  if (aeo.trackAiReferrals === true) {
    lines.push(
      "AI referral tracking: enabled. Include attributable traffic from ChatGPT, Claude, Perplexity, Copilot and other AI assistants in analytics reporting.",
    );
  }
  const channels = Array.isArray(monitoring.channels)
    ? monitoring.channels.filter((c): c is string => typeof c === "string")
    : [];
  if (channels.length > 0) {
    lines.push(`Channels being watched: ${channels.join(", ")}`);
  }
  const requestedPlugins = Array.isArray(plugins.integrations)
    ? plugins.integrations
        .map((item) => text(record(item).name))
        .filter(Boolean)
    : [];
  if (requestedPlugins.length > 0) {
    lines.push(
      `Tools the user already uses: ${requestedPlugins.join(", ")}. These selections express relevance, not connection status. Prefer a matching Chief plugin when one is available; otherwise use Chief's secure setup and Executor capabilities. Always ask before opening sign-in or changing an external account.`,
    );
  }
  const integrations = Array.isArray(analytics.integrations)
    ? analytics.integrations
        .map((item) => text(record(item).name))
        .filter(Boolean)
    : [];
  if (integrations.length > 0) {
    lines.push(`Analytics sources chosen at setup: ${integrations.join(", ")}`);
  } else if (analytics.selection === "none") {
    lines.push(
      "Analytics setup choice: none. Do not connect or recommend an analytics provider during initial onboarding.",
    );
  } else if (analytics.selection === "skipped") {
    lines.push(
      "Analytics setup choice: deferred. Do not start analytics setup during initial onboarding.",
    );
  }
  const schedulingAuthority = text(automation.mode);
  if (
    schedulingAuthority === "automatic" ||
    schedulingAuthority === "review" ||
    schedulingAuthority === "manual"
  ) {
    lines.push(`Agent scheduling authority: ${schedulingAuthority}`);
  }
  const timezone = text(automation.timezone);
  const enabledPlan = Array.isArray(automation.plan)
    ? automation.plan
        .map((item) => record(item))
        .filter((item) => item.enabled === true)
    : [];
  const plan = enabledPlan
    .map((item) => {
      const title = text(item.title);
      const frequency = text(item.frequency);
      const time = text(item.time);
      return title
        ? `${title}: ${frequency || "scheduled"}${time ? ` at ${time}` : ""}${timezone ? ` (${timezone})` : ""}`
        : "";
    })
    .filter(Boolean);
  if (plan.length > 0) {
    lines.push(`Approved starter schedule:\n- ${plan.join("\n- ")}`);
  }
  if (schedulingAuthority === "automatic" && enabledPlan.length > 0) {
    const scope = enabledPlan.map((item) => {
      const [hour = "9", minute = "0"] = text(item.time).split(":");
      const frequency = text(item.frequency);
      const day =
        typeof item.day === "number" && item.day >= 0 && item.day <= 6
          ? item.day
          : 1;
      return {
        playbookId: text(item.playbookId),
        agentId: text(item.agentId),
        cron:
          frequency === "weekdays"
            ? `${Number(minute)} ${Number(hour)} * * 1-5`
            : `${Number(minute)} ${Number(hour)} * * ${day}`,
        timezone,
      };
    });
    lines.push(`Automatic schedule scope: ${JSON.stringify(scope)}`);
  }

  return lines.join("\n");
}

export async function buildWorkspaceContext(
  workspaceId: string | null,
): Promise<string | undefined> {
  if (!workspaceId) return undefined;
  const organizations = await listAuthOrganizations();
  const org =
    organizations.find((candidate) => candidate.id === workspaceId) ??
    organizations[0];
  return workspaceContextFromOrganization(org);
}
