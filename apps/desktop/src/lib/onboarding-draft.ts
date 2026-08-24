import { z } from "zod";

import type {
  AgentDeploymentTarget,
  DriverType,
} from "@chief/agent-runtime/types";

import type { AuthOrganization } from "./auth/better-auth-contracts";
import type { IntegrationSearchResult } from "./integrations";
import type { OnboardingStep } from "./onboarding-flow";
import type { SocialPlatform } from "./social-platforms";
import { parseOrganizationMetadata } from "./auth/better-auth-contracts";
import { resumableOnboardingStep } from "./onboarding-flow";

export type AutomationMode = "automatic" | "review" | "manual";
export type AutomationFrequency = "daily" | "weekly";

export interface OnboardingAutomationItem {
  playbookId: string;
  title: string;
  agentId: string;
  purpose: string;
  enabled: boolean;
  frequency: AutomationFrequency;
  day: number;
  time: string;
}

export interface OnboardingBrandFile {
  name: string;
  type: string;
  dataUrl: string;
}

export interface OnboardingDraft {
  workspaceMode: "local" | "cloud";
  companyName: string;
  websiteUrl: string;
  socials: Partial<Record<SocialPlatform, string>>;
  providerMode: "local" | "deployed";
  provider: DriverType | null;
  model: string;
  deploymentProvider: AgentDeploymentTarget | null;
  cloudDeploymentUrl: string;
  brand: {
    mode: "research" | "upload" | "skip";
    notes: string;
    files: OnboardingBrandFile[];
  };
  goals: {
    selling: string;
    audience: string;
    success: string[];
    timeBudget: string;
  };
  monitoring: {
    channels: string[];
    details: string;
    keywords: string;
  };
  plugins: { integrations: IntegrationSearchResult[] };
  analytics: {
    integrations: IntegrationSearchResult[];
    selection: "selected" | "none" | "skipped" | null;
  };
  ads: { integrations: IntegrationSearchResult[]; budget: string };
  aeo: { trackAiReferrals: boolean };
  engineering: {
    enabled: boolean | null;
    integrations: IntegrationSearchResult[];
  };
  automation: {
    defaultsVersion: number;
    mode: AutomationMode;
    timezone: string;
    plan: OnboardingAutomationItem[];
  };
  step: OnboardingStep;
}

const integrationSchema: z.ZodType<IntegrationSearchResult> = z.object({
  domain: z.string(),
  name: z.string(),
  description: z.string(),
  kinds: z.array(z.string()),
  url: z.string(),
});

const brandFileSchema: z.ZodType<OnboardingBrandFile> = z.object({
  name: z.string(),
  type: z.string(),
  dataUrl: z.string(),
});

const channelsSchema = z.union([z.array(z.string()), z.string()]);
const successSchema = z.union([z.array(z.string()), z.string()]);
const providerSchema = z
  .enum(["claude", "codex", "opencode", "remote", "vercel"])
  .optional();
const automationPlanItemSchema = z.object({
  playbookId: z.string(),
  enabled: z.boolean().optional(),
  frequency: z.enum(["daily", "weekly", "weekdays"]).optional(),
  day: z.number().min(0).max(6).optional(),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/u)
    .optional(),
});

const onboardingDataSchema = z.object({
  workspaceMode: z.enum(["local", "cloud"]).optional(),
  companyName: z.string().optional(),
  websiteUrl: z.string().optional(),
  socials: z
    .object({
      x: z.string().optional(),
      instagram: z.string().optional(),
      linkedin: z.string().optional(),
      tiktok: z.string().optional(),
      youtube: z.string().optional(),
      reddit: z.string().optional(),
    })
    .optional(),
  providerMode: z.enum(["local", "deployed"]).optional(),
  provider: providerSchema,
  model: z.string().optional(),
  deploymentProvider: z.literal("vercel").optional(),
  cloudDeploymentUrl: z.string().optional(),
  brand: z
    .object({
      mode: z.enum(["research", "upload", "skip"]).optional(),
      notes: z.string().optional(),
      files: z.array(brandFileSchema).optional(),
    })
    .optional(),
  goals: z
    .object({
      selling: z.string().optional(),
      audience: z.string().optional(),
      success: successSchema.optional(),
      timeBudget: z.string().optional(),
    })
    .optional(),
  monitoring: z
    .object({
      channels: channelsSchema.optional(),
      details: z.string().optional(),
      keywords: z.string().optional(),
    })
    .optional(),
  plugins: z
    .object({ integrations: z.array(integrationSchema).optional() })
    .optional(),
  analytics: z
    .object({
      integrations: z.array(integrationSchema).optional(),
      selection: z.enum(["selected", "none", "skipped"]).nullable().optional(),
    })
    .optional(),
  ads: z
    .object({
      integrations: z.array(integrationSchema).optional(),
      budget: z.string().optional(),
    })
    .optional(),
  aeo: z.object({ trackAiReferrals: z.boolean().optional() }).optional(),
  engineering: z
    .object({
      enabled: z.boolean().nullable().optional(),
      integrations: z.array(integrationSchema).optional(),
    })
    .optional(),
  automation: z
    .object({
      defaultsVersion: z.number().optional(),
      mode: z.enum(["automatic", "review", "manual"]).optional(),
      timezone: z.string().min(1).optional(),
      plan: z.array(automationPlanItemSchema).optional(),
    })
    .optional(),
  step: z.string().optional(),
  completedAt: z.string().optional(),
});

export function defaultAutomationPlan(): OnboardingAutomationItem[] {
  return [
    {
      playbookId: "buying-signals",
      title: "Find buying signals",
      agentId: "prospector",
      purpose: "Surface people already describing the problem you solve.",
      enabled: true,
      frequency: "daily",
      day: 1,
      time: "09:00",
    },
    {
      playbookId: "founder-content",
      title: "Founder content",
      agentId: "content",
      purpose: "Turn what the company is learning into useful draft posts.",
      enabled: true,
      frequency: "weekly",
      day: 2,
      time: "10:00",
    },
    {
      playbookId: "brand-content",
      title: "Brand content",
      agentId: "content",
      purpose: "Draft useful brand-led posts from product and customer proof.",
      enabled: true,
      frequency: "weekly",
      day: 4,
      time: "10:00",
    },
    {
      playbookId: "growth-brief",
      title: "Growth report",
      agentId: "analyst",
      purpose: "Explain what changed and recommend the next action.",
      enabled: true,
      frequency: "weekly",
      day: 5,
      time: "15:00",
    },
  ];
}

function localTimezone() {
  const { timeZone } = Intl.DateTimeFormat().resolvedOptions();
  return timeZone.length > 0 ? timeZone : "Australia/Brisbane";
}

export function baseOnboardingDraft(): OnboardingDraft {
  return {
    workspaceMode: "local",
    companyName: "",
    websiteUrl: "",
    socials: {},
    providerMode: "local",
    provider: null,
    model: "",
    deploymentProvider: null,
    cloudDeploymentUrl: "",
    brand: { mode: "research", notes: "", files: [] },
    goals: { selling: "", audience: "", success: [], timeBudget: "" },
    monitoring: { channels: [], details: "", keywords: "" },
    plugins: { integrations: [] },
    analytics: { integrations: [], selection: null },
    ads: { integrations: [], budget: "" },
    aeo: { trackAiReferrals: false },
    engineering: { enabled: null, integrations: [] },
    automation: {
      defaultsVersion: 2,
      mode: "manual",
      timezone: localTimezone(),
      plan: defaultAutomationPlan(),
    },
    step: "mode",
  };
}

export function onboardingStorageKey(organizationId: string) {
  return `chief-onboarding:${organizationId}`;
}

export function pendingOnboardingStorageKey() {
  return onboardingStorageKey("pending");
}

export function onboardingWorkspaceSlug(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  const suffix = Math.random().toString(36).slice(2, 8);
  return base ? `${base}-${suffix}` : suffix;
}

function channels(value: string[] | string | undefined, fallback: string[]) {
  if (Array.isArray(value)) return value;
  if (!value?.trim()) return fallback;
  return value
    .split(/\n|,/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function successes(value: string[] | string | undefined, fallback: string[]) {
  if (Array.isArray(value)) return value;
  return value ? [value] : fallback;
}

function provider(
  value: z.output<typeof providerSchema>,
  fallback: DriverType | null,
) {
  if (value === "vercel") return "remote";
  return value ?? fallback;
}

function automationPlan(
  saved: z.output<typeof automationPlanItemSchema>[] | undefined,
) {
  const defaults = defaultAutomationPlan();
  if (!saved) return defaults;
  return defaults.map((fallback) => {
    const item = saved.find(
      (candidate) => candidate.playbookId === fallback.playbookId,
    );
    return {
      ...fallback,
      enabled: item?.enabled ?? fallback.enabled,
      frequency:
        item?.frequency === "weekdays"
          ? "daily"
          : (item?.frequency ?? fallback.frequency),
      day: item?.day ?? fallback.day,
      time: item?.time ?? fallback.time,
    };
  });
}

function mergeDraft(
  base: OnboardingDraft,
  parsed: z.output<typeof onboardingDataSchema>,
): OnboardingDraft {
  const legacyStep = new Set([
    "analyticsConnect",
    "adsConnect",
    "analytics",
    "ads",
    "adsBudget",
    "aeo",
    "engineering",
    "engineeringTools",
  ]).has(parsed.step ?? "");
  return {
    ...base,
    workspaceMode:
      parsed.workspaceMode === "cloud" || parsed.providerMode === "deployed"
        ? "cloud"
        : "local",
    companyName: parsed.companyName ?? base.companyName,
    websiteUrl: parsed.websiteUrl ?? base.websiteUrl,
    socials: { ...base.socials, ...parsed.socials },
    providerMode: parsed.providerMode === "deployed" ? "deployed" : "local",
    provider: provider(parsed.provider, base.provider),
    model: parsed.model ?? base.model,
    deploymentProvider:
      parsed.deploymentProvider === "vercel" || parsed.provider === "vercel"
        ? "vercel"
        : base.deploymentProvider,
    cloudDeploymentUrl: parsed.cloudDeploymentUrl ?? base.cloudDeploymentUrl,
    brand: {
      mode: parsed.brand?.mode ?? base.brand.mode,
      notes: parsed.brand?.notes ?? base.brand.notes,
      files: parsed.brand?.files ?? base.brand.files,
    },
    goals: {
      selling: parsed.goals?.selling ?? base.goals.selling,
      audience: parsed.goals?.audience ?? base.goals.audience,
      success: successes(parsed.goals?.success, base.goals.success),
      timeBudget: parsed.goals?.timeBudget ?? base.goals.timeBudget,
    },
    monitoring: {
      channels: channels(parsed.monitoring?.channels, base.monitoring.channels),
      details: parsed.monitoring?.details ?? base.monitoring.details,
      keywords: parsed.monitoring?.keywords ?? base.monitoring.keywords,
    },
    plugins: { integrations: parsed.plugins?.integrations ?? [] },
    analytics: {
      integrations: parsed.analytics?.integrations ?? [],
      selection: parsed.analytics?.selection ?? null,
    },
    ads: {
      integrations: parsed.ads?.integrations ?? [],
      budget: parsed.ads?.budget ?? base.ads.budget,
    },
    aeo: {
      trackAiReferrals:
        parsed.aeo?.trackAiReferrals ?? base.aeo.trackAiReferrals,
    },
    engineering: {
      enabled: parsed.engineering?.enabled ?? base.engineering.enabled,
      integrations: parsed.engineering?.integrations ?? [],
    },
    automation: {
      defaultsVersion: 2,
      mode: parsed.automation?.mode ?? base.automation.mode,
      timezone: parsed.automation?.timezone ?? base.automation.timezone,
      plan: automationPlan(parsed.automation?.plan),
    },
    step: legacyStep
      ? "plugins"
      : parsed.step
        ? resumableOnboardingStep(parsed.step)
        : base.step,
  };
}

function draftFromOrganization(
  organization: AuthOrganization,
  userName?: string,
) {
  const metadata = parseOrganizationMetadata(organization);
  const parsed = onboardingDataSchema.safeParse(metadata.onboarding);
  const onboarding = parsed.success ? parsed.data : {};
  const looksPersonal =
    z.string().safeParse(metadata.personalOrgUserId).success ||
    Boolean(
      userName?.trim() &&
      organization.name.trim().toLowerCase() === userName.trim().toLowerCase(),
    );
  const base = baseOnboardingDraft();
  const merged = mergeDraft(base, onboarding);
  return {
    ...merged,
    companyName: looksPersonal ? "" : organization.name,
    websiteUrl:
      z.string().safeParse(metadata.websiteUrl).data ?? merged.websiteUrl,
    step: onboarding.completedAt ? "finish" : merged.step,
  };
}

function loadStoredDraft(base: OnboardingDraft, key: string) {
  try {
    const legacyKey = key.replace(
      /^chief-onboarding:/u,
      "marketer-onboarding:",
    );
    const stored = localStorage.getItem(key) ?? localStorage.getItem(legacyKey);
    if (!stored) return base;
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, stored);
      localStorage.removeItem(legacyKey);
    }
    const parsed = onboardingDataSchema.safeParse(JSON.parse(stored));
    return parsed.success ? mergeDraft(base, parsed.data) : base;
  } catch {
    return base;
  }
}

export function loadOnboardingDraft(
  organization: AuthOrganization,
  userName?: string,
) {
  return loadStoredDraft(
    draftFromOrganization(organization, userName),
    onboardingStorageKey(organization.id),
  );
}

export function loadPendingOnboardingDraft() {
  return loadStoredDraft(baseOnboardingDraft(), pendingOnboardingStorageKey());
}
