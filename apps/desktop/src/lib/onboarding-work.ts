import type { OnboardingWorkJob } from "@chief/agent-runtime/types";

import type { IntegrationSearchResult } from "./integrations";
import { integrationSetupTask } from "./integration-setup";
import { onboardingScopedId } from "./onboarding-ids";

interface BrandFile {
  name: string;
  type: string;
  dataUrl?: string;
}

export interface OnboardingWorkInput {
  workspaceId: string;
  companyName: string;
  websiteUrl: string;
  timezone: string;
  brand: {
    mode: string;
    notes: string;
    files: BrandFile[];
  };
  analytics: { integrations: IntegrationSearchResult[] };
  ads: { integrations: IntegrationSearchResult[] };
}

const COMMON_SETUP_TOOLS = [
  "tools.search",
  "tools.executor.coreTools.connections.list",
  "tools.chief.org.workspace.agentTools.sourcesList",
  "tools.chief.org.workspace.agentTools.integrationsMarkConnected",
  "tools.chief-local.org.localworkspace.localTools.attentionRaise",
];

export function buildOnboardingWorkJobs(
  input: OnboardingWorkInput,
): OnboardingWorkJob[] {
  const now = Date.now();
  const jobs: OnboardingWorkJob[] = [];
  const attachments = input.brand.files.flatMap((file) =>
    file.dataUrl ? [{ ...file, dataUrl: file.dataUrl }] : [],
  );

  if (input.brand.mode !== "skip") {
    jobs.push({
      id: onboardingScopedId(input.workspaceId, "brand-setup"),
      agentId: "brand",
      title: "Build brand profile",
      runAt: now + 1_000,
      timezone: input.timezone,
      proposedToolPatterns: [
        ...COMMON_SETUP_TOOLS,
        "tools.chief-local.org.localworkspace.localTools.brandProfileSave",
      ],
      attachments,
      instructions: [
        "Build and save a practical brand profile for every agent in this workspace.",
        `Company: ${input.companyName}`,
        `Website: ${input.websiteUrl}`,
        attachments.length > 0
          ? "Read the files supplied during onboarding, then use the public website to fill only genuine gaps."
          : "Research the public website and other first-party public pages. Infer the voice from real copy and clearly label anything uncertain.",
        input.brand.notes ? `User notes: ${input.brand.notes}` : undefined,
        "Save a concise Markdown profile with voice principles, vocabulary, claims that are supported, claims to avoid, visual cues, audience, and three representative writing examples. Use brandProfileSave so future agents receive it automatically.",
        "Work proactively. Ask the user only if a missing fact would make the profile unsafe or materially misleading.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
  }

  const addIntegrationJob = (
    category: "analytics" | "ads",
    integrations: IntegrationSearchResult[],
    delayMs: number,
  ) => {
    if (integrations.length === 0) return;
    const names = integrations.map((item) => item.name).join(", ");
    jobs.push({
      id: onboardingScopedId(input.workspaceId, `${category}-setup`),
      agentId: "setup",
      title: `Connect ${category} tools`,
      runAt: now + delayMs,
      timezone: input.timezone,
      proposedToolPatterns: [
        ...COMMON_SETUP_TOOLS,
        "tools.chief-local.org.localworkspace.localTools.googleAnalyticsProperties",
        "tools.chief-local.org.localworkspace.localTools.googleAnalyticsMetadata",
        "tools.chief-local.org.localworkspace.localTools.googleAnalyticsRunReport",
      ],
      instructions: [
        `Set up the ${category} integrations selected during onboarding: ${names}.`,
        `Selected services and domains: ${integrations.map((item) => `${item.name} (${item.domain})`).join(", ")}.`,
        "Complete each provider using its provider-specific setup contract below. Do not replace it with a generic OAuth flow.",
        ...integrations.map((integration) =>
          integrationSetupTask({
            domain: integration.domain,
            name: integration.name,
          }),
        ),
      ].join("\n\n"),
    });
  };

  addIntegrationJob("analytics", input.analytics.integrations, 2_000);
  addIntegrationJob("ads", input.ads.integrations, 3_000);
  return jobs;
}

function integrations(value: unknown): IntegrationSearchResult[] {
  if (!value || typeof value !== "object") return [];
  const candidates = (value as { integrations?: unknown }).integrations;
  if (!Array.isArray(candidates)) return [];
  return candidates.filter((item): item is IntegrationSearchResult =>
    Boolean(
      item &&
      typeof item === "object" &&
      typeof (item as { domain?: unknown }).domain === "string" &&
      typeof (item as { name?: unknown }).name === "string",
    ),
  );
}

export function onboardingWorkFromMetadata(
  workspaceId: string,
  companyName: string,
  websiteUrl: string,
  onboarding: Record<string, unknown>,
): OnboardingWorkJob[] {
  const brand =
    onboarding.brand && typeof onboarding.brand === "object"
      ? (onboarding.brand as Record<string, unknown>)
      : {};
  const automation =
    onboarding.automation && typeof onboarding.automation === "object"
      ? (onboarding.automation as Record<string, unknown>)
      : {};
  return buildOnboardingWorkJobs({
    workspaceId,
    companyName,
    websiteUrl,
    timezone:
      typeof automation.timezone === "string"
        ? automation.timezone
        : Intl.DateTimeFormat().resolvedOptions().timeZone,
    brand: {
      mode: typeof brand.mode === "string" ? brand.mode : "skip",
      notes: typeof brand.notes === "string" ? brand.notes : "",
      files: Array.isArray(brand.files)
        ? brand.files.flatMap((file) =>
            file &&
            typeof file === "object" &&
            typeof (file as { name?: unknown }).name === "string" &&
            typeof (file as { type?: unknown }).type === "string"
              ? [
                  {
                    name: (file as { name: string }).name,
                    type: (file as { type: string }).type,
                  },
                ]
              : [],
          )
        : [],
    },
    analytics: { integrations: integrations(onboarding.analytics) },
    ads: { integrations: integrations(onboarding.ads) },
  });
}
