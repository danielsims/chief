import type { OnboardingWorkJob } from "@chief/agent-runtime/types";
import { isJsonObject, isJsonString } from "@chief/relay-contracts";

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
  plugins: {
    integrations: IntegrationSearchResult[];
  };
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

const ENGINEERING_KICKOFF_TOOLS = [
  "tools.search",
  "tools.executor.coreTools.connections.list",
  "tools.chief.org.workspace.agentTools.sourcesList",
  "tools.chief-local.org.localworkspace.localTools.pluginsList",
  "tools.chief-local.org.localworkspace.localTools.pluginsRecommend",
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
              "Build and save a practical provisional brand profile for every agent in this workspace.",
              `Company: ${input.companyName}`,
              `Website: ${input.websiteUrl}`,
              attachments.length > 0
                ? "Read the files supplied during onboarding, then use the public website to fill only genuine gaps."
                : "Research the public website and other first-party public pages. Infer the voice from real copy and clearly label anything uncertain.",
              input.brand.notes
                ? `User notes: ${input.brand.notes}`
                : undefined,
              "Return a complete Markdown profile with voice principles, vocabulary, supported claims, claims to avoid, visual cues, audience, and three representative writing examples. Save the verified profile to durable memory and as a visible versioned workspace file.",
              "Work proactively. If one missing preference would make the profile unsafe, materially misleading, or too generic to use, ask one compact structured question in the Marketing thread and continue when answered. Public accounts and brand preferences belong in this specialist conversation, not workspace setup.",
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ];

  const engineeringJob: OnboardingWorkJob = {
    id: onboardingScopedId(input.workspaceId, "engineering-channel-kickoff"),
    agentId: "engineer",
    title: "Prepare the engineering workspace",
    runAt: Date.now(),
    timezone: input.timezone,
    proposedToolPatterns: ENGINEERING_KICKOFF_TOOLS,
    instructions: [
      "Launch this independently in the initial concurrent kickoff. Work in the Engineering channel and do not wait for brand or prospecting work.",
      `Company website: ${input.websiteUrl}`,
      input.plugins.integrations.length > 0
        ? `The user said they already use these tools: ${input.plugins.integrations.map((integration) => `${integration.name} (${integration.domain})`).join(", ")}. Treat the selections as relevance, never as proof that an account is connected. Every selected tool relevant to engineering is a required baseline recommendation.`
        : "The user did not name any existing tools during workspace setup.",
      "Inspect available workspace context and connected sources read-only. Post a short, conversational welcome in Engineering explaining what you can help with. Write like a technical teammate in chat, not a status report.",
      "Use localTools.pluginsList privately if you need catalog discovery, then call localTools.pluginsRecommend with the current Engineering channelId and threadRootId. Pass every engineering-relevant onboarding selection to services using its exact `Name (domain)` value. That call must publish every selected service as an actionable inline card in this thread, using a catalog plugin when one exists and Chief's secure setup flow when it does not. Never use prose markers such as Card: to imitate UI, and do not tell the user to visit settings when an actionable card can be rendered.",
      "Do not replace a selected service with a similar tool, and do not omit one because another catalog result scored higher. You may recommend a small number of additional tools only after every relevant selected service is represented, and clearly keep extras secondary. A selection is relevance, not permission to install or authorize it. Do not authenticate, change code, create a branch, or deploy anything during this welcome; let the user choose the next concrete task.",
    ].join("\n\n"),
  };

  const prospectorJob: OnboardingWorkJob = {
    id: onboardingScopedId(input.workspaceId, "initial-prospecting"),
    agentId: "prospector",
    title: "Find the first qualified prospects and buying signals",
    runAt: Date.now(),
    timezone: input.timezone,
    proposedToolPatterns: PROSPECT_KICKOFF_TOOLS,
    instructions: [
      "Launch this as one independent delegation in the initial concurrent Chief kickoff. Do not wait for brand research, integration setup, or analytics.",
      "Use the best available product, customer, brand, and public-website evidence as the initial qualification brief. Do not assume setup already captured an ideal customer or preferred channels.",
      "If one missing customer or source decision would materially change qualification, ask one compact structured question in the Prospecting thread, then continue from the answer. Do not turn this into an intake questionnaire and do not ask for facts you can research.",
      "Find five to eight recent, high-confidence people, companies, or public conversations with a concrete reason to care now. Search public Reddit and other accessible web communities even when no connector is installed.",
      "Make at most three deliberate search passes. If a site blocks direct access or a search engine rate-limits, use one accessible fallback and then continue with indexed snippets or other public sources. Do not brute-force mirrors, retry captchas, or inspect Chief's connections and runtime internals.",
      "Every result must have a direct HTTP source URL, quoted or specific evidence, relevance, and a useful value-first reply or outreach angle.",
      "Save every qualified result with the direct localTools.prospectsSave tool before returning it to Chief. Return fewer results when the evidence is genuinely sparse rather than looping. Do not return an unsaved list and do not invent people, posts, or URLs.",
    ].join("\n\n"),
  };

  return [...brandJob, engineeringJob, prospectorJob];
}

function integrations(value: unknown): IntegrationSearchResult[] {
  if (!value || !isJsonObject(value)) return [];
  const candidates = (value as { integrations?: unknown }).integrations;
  if (!Array.isArray(candidates)) return [];
  return candidates.filter((item): item is IntegrationSearchResult =>
    Boolean(
      item &&
      isJsonObject(item) &&
      isJsonString((item as { domain?: unknown }).domain) &&
      isJsonString((item as { name?: unknown }).name),
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
    onboarding.brand && isJsonObject(onboarding.brand)
      ? (onboarding.brand as Record<string, unknown>)
      : {};
  const automation =
    onboarding.automation && isJsonObject(onboarding.automation)
      ? (onboarding.automation as Record<string, unknown>)
      : {};
  const selectedPlugins = integrations(onboarding.plugins);
  const legacySelections = [
    ...integrations(onboarding.analytics),
    ...integrations(onboarding.ads),
    ...integrations(onboarding.engineering),
  ];
  return buildOnboardingWorkJobs({
    workspaceId,
    companyName,
    websiteUrl,
    timezone: isJsonString(automation.timezone)
      ? automation.timezone
      : Intl.DateTimeFormat().resolvedOptions().timeZone,
    brand: {
      mode: isJsonString(brand.mode) ? brand.mode : "skip",
      notes: isJsonString(brand.notes) ? brand.notes : "",
      files: Array.isArray(brand.files)
        ? brand.files.flatMap((file) =>
            file &&
            isJsonObject(file) &&
            isJsonString((file as { name?: unknown }).name) &&
            isJsonString((file as { type?: unknown }).type)
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
    plugins: {
      integrations: (selectedPlugins.length > 0
        ? selectedPlugins
        : legacySelections
      ).filter(
        (integration, index, all) =>
          all.findIndex((item) => item.domain === integration.domain) === index,
      ),
    },
  });
}
