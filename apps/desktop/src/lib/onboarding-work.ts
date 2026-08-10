import type { OnboardingWorkJob } from "@chief/agent-runtime/types";

import type { IntegrationSearchResult } from "./integrations";
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
  aeo: { trackAiReferrals: boolean };
}

const BRAND_KICKOFF_TOOLS = [
  "tools.search",
  "tools.executor.coreTools.connections.list",
  "tools.chief.org.workspace.agentTools.sourcesList",
  "tools.chief-local.org.localworkspace.localTools.brandProfileSave",
];

const PROSPECT_KICKOFF_TOOLS = [
  "tools.search",
  "tools.chief-local.org.localworkspace.localTools.prospectsList",
  "tools.chief-local.org.localworkspace.localTools.prospectsSave",
  "tools.chief-local.org.localworkspace.localTools.trendsList",
  "tools.chief-local.org.localworkspace.localTools.trendsSave",
];

const SETUP_KICKOFF_TOOLS = [
  "tools.search",
  "tools.executor.coreTools.connections.*",
  "tools.chief.org.workspace.agentTools.integrationsMarkConnected",
  "tools.chief-local.org.localworkspace.localTools.googleAnalyticsAuthorize",
  "tools.chief-local.org.localworkspace.localTools.googleAnalyticsComplete",
  "tools.chief-local.org.localworkspace.localTools.googleAnalyticsSelect",
  "tools.chief-local.org.localworkspace.localTools.integrationOpenHandoff",
];

const ANALYST_KICKOFF_TOOLS = [
  "tools.search",
  "tools.google_analytics.org.main.*",
  "tools.chief-local.org.localworkspace.localTools.analyticsSaveDataset",
  "tools.chief.org.workspace.agentTools.uiPresentChart",
];

export function buildOnboardingWorkJobs(
  input: OnboardingWorkInput,
): OnboardingWorkJob[] {
  const attachments = input.brand.files.flatMap((file) =>
    file.dataUrl ? [{ ...file, dataUrl: file.dataUrl }] : [],
  );

  const brandJob: OnboardingWorkJob[] =
    input.brand.mode === "skip"
      ? []
      : [
          {
            id: onboardingScopedId(input.workspaceId, "brand-research-kickoff"),
            agentId: "brand",
            title: "Research the brand and establish a working profile",
            runAt: Date.now(),
            timezone: input.timezone,
            proposedToolPatterns: BRAND_KICKOFF_TOOLS,
            attachments,
            instructions: [
              "Launch this as one independent delegation in the initial concurrent Chief kickoff.",
              "This job must never block Setup, Prospector, or any other independent kickoff work. If it fails, Chief must continue and label the brand profile as provisional.",
              "Inspect workspace context and already-connected sources before asking the user for anything.",
              "Build and save a practical brand profile for every agent in this workspace.",
              `Company: ${input.companyName}`,
              `Website: ${input.websiteUrl}`,
              attachments.length > 0
                ? "Read the files supplied during onboarding, then use the public website to fill only genuine gaps."
                : "Research the public website and other first-party public pages. Infer the voice from real copy and clearly label anything uncertain.",
              input.brand.notes
                ? `User notes: ${input.brand.notes}`
                : undefined,
              "Return a complete Markdown profile with voice principles, vocabulary, supported claims, claims to avoid, visual cues, audience, and three representative writing examples. Chief must save the verified profile to durable memory and as a visible versioned workspace file.",
              "Work proactively. Ask the user only if a missing fact would make the profile unsafe or materially misleading.",
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ];

  const selectedIntegrations = [
    ...input.analytics.integrations.map((integration) => ({
      ...integration,
      category: "analytics",
    })),
    ...input.ads.integrations.map((integration) => ({
      ...integration,
      category: "ads",
    })),
  ].filter(
    (integration, index, all) =>
      all.findIndex((item) => item.domain === integration.domain) === index,
  );
  const setupJobs: OnboardingWorkJob[] = selectedIntegrations.map(
    (integration) => {
      const attemptId = onboardingScopedId(
        input.workspaceId,
        `setup-attempt-${integration.domain}`,
      );
      return {
        id: onboardingScopedId(
          input.workspaceId,
          `integration-setup-${integration.domain}`,
        ),
        agentId: "setup",
        title: `Connect ${integration.name}`,
        runAt: Date.now(),
        timezone: input.timezone,
        proposedToolPatterns: SETUP_KICKOFF_TOOLS,
        setupDomain: integration.domain,
        setupAttemptId: attemptId,
        instructions: [
          "Launch this independently in the initial concurrent kickoff. It does not depend on brand research, prospecting, or another selected integration setup.",
          `Connect and verify ${integration.name} (${integration.domain}) for the ${integration.category} category selected during onboarding.`,
          `Chief must delegate this with setupDomain=${integration.domain} and setupAttemptId=${attemptId}.`,
          "Use the dedicated setup tools and current Chief session identity. Complete safe local steps autonomously. If consent, credentials, or account selection genuinely needs the user, return that exact requirement to Chief as one structured action without blocking unrelated kickoff work; never invent success.",
        ].join("\n\n"),
      };
    },
  );
  const analystJobs: OnboardingWorkJob[] =
    input.analytics.integrations.length > 0
      ? [
          {
            id: onboardingScopedId(input.workspaceId, "initial-growth-report"),
            agentId: "analyst",
            title: "Build the first growth report",
            runAt: Date.now(),
            timezone: input.timezone,
            proposedToolPatterns: ANALYST_KICKOFF_TOOLS,
            instructions: [
              "Run only after the selected analytics setup job has completed successfully.",
              "Pull a live current-period and previous-period report from the verified source, save the overview dataset locally with analyticsSaveDataset, and present the primary chart.",
              input.aeo.trackAiReferrals
                ? "Include attributable AI referral traffic and clearly separate direct evidence from dark traffic."
                : undefined,
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ]
      : [];

  const prospectorJob: OnboardingWorkJob = {
    id: onboardingScopedId(input.workspaceId, "initial-prospecting"),
    agentId: "prospector",
    title: "Find the first qualified prospects and buying signals",
    runAt: Date.now(),
    timezone: input.timezone,
    proposedToolPatterns: PROSPECT_KICKOFF_TOOLS,
    instructions: [
      "Launch this as one independent delegation in the initial concurrent Chief kickoff. Do not wait for brand research, integration setup, or analytics.",
      "Use the workspace ideal customer, monitored channels, product, and public website as the qualification brief.",
      "Find five to eight recent, high-confidence people, companies, or public conversations with a concrete reason to care now. Search public Reddit and other accessible web communities even when no connector is installed.",
      "Every result must have a direct HTTP source URL, quoted or specific evidence, relevance, and a useful value-first reply or outreach angle.",
      "Save every qualified result with prospectsSave before returning it to Chief. Do not return an unsaved list and do not invent people, posts, or URLs.",
    ].join("\n\n"),
  };

  return [...brandJob, ...setupJobs, prospectorJob, ...analystJobs];
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
  const aeo =
    onboarding.aeo && typeof onboarding.aeo === "object"
      ? (onboarding.aeo as Record<string, unknown>)
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
    aeo: { trackAiReferrals: aeo.trackAiReferrals === true },
  });
}
