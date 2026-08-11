/* eslint-disable max-lines */

import type { ReactNode } from "react";
import type { SimpleIcon } from "simple-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Claude, OpenAI, OpenCode, Vercel } from "@lobehub/icons";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import {
  Check,
  CheckCircle2,
  Cloud,
  Facebook,
  Globe,
  Instagram,
  Laptop,
  Linkedin,
  MessageCircle,
  Pencil,
  Search,
  Server,
  Twitter,
  Youtube,
} from "lucide-react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { siInstagram, siReddit, siTiktok, siX, siYoutube } from "simple-icons";

import type {
  AgentDeploymentRecord,
  AgentDeploymentTarget,
  DriverType,
} from "@chief/agent-runtime/types";
import { api } from "@chief/backend/convex/_generated/api";
import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import { PrefixedInput } from "@chief/ui/components/prefixed-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@chief/ui/components/select";
import { SuccessCheck } from "@chief/ui/components/success-check";
import { cn } from "@chief/ui/lib/utils";

import type { AuthOrganization } from "../lib/auth/better-auth-client";
import type { IntegrationSearchResult } from "../lib/integrations";
import type { OnboardingStep } from "../lib/onboarding-flow";
import type { SocialPlatform } from "../lib/social-platforms";
import { ConvexLogo } from "../components/convex-logo";
import { IntegrationAvatarStack } from "../components/integrations/integration-avatar-stack";
import { IntegrationChoiceCard } from "../components/integrations/integration-choice-card";
import {
  EngineeringAccessControl,
  EngineeringToolsControl,
} from "../components/onboarding/engineering-setup-controls";
import {
  Chip,
  StepFrame,
} from "../components/onboarding/onboarding-step-frame";
import { resolveFaviconUrl } from "../components/org-logo";
import { useAgentDeployments } from "../lib/agent-deployments";
import {
  clearWorkspaceProvider,
  setWorkspaceProvider,
} from "../lib/agent-overrides";
import {
  AI_GATEWAY_API_KEY,
  AI_GATEWAY_INPUT_REQUEST,
  AI_GATEWAY_KEYS_URL,
} from "../lib/ai-gateway-input";
import { useAuth } from "../lib/auth/auth-context";
import {
  createAuthOrganization,
  listAuthOrganizations,
  parseOrganizationMetadata,
  setActiveAuthOrganization,
  updateAuthOrganization,
} from "../lib/auth/better-auth-client";
import {
  cachedIntegrationSearch,
  searchIntegrations,
} from "../lib/integrations";
import { primeLocalIntegrationStatus } from "../lib/local-integration-status-cache";
import {
  LOCAL_ONBOARDING_FALLBACK,
  nextOnboardingStep,
  ONBOARDING_STEPS,
} from "../lib/onboarding-flow";
import { buildOnboardingSchedules } from "../lib/onboarding-schedules";
import { buildOnboardingWorkJobs } from "../lib/onboarding-work";
import { getPlaybook, playbookInstructions, PLAYBOOKS } from "../lib/playbooks";
import {
  updatePendingOnboardingDriver,
  useAgentPreferences,
  useProviderModels,
  useRuntime,
  useStoredInputs,
  useWorkspaceData,
} from "../lib/runtime";
import { SOCIAL_PLATFORMS } from "../lib/social-platforms";
import { workspaceContextFromOrganization } from "../lib/workspace-context";

type AutomationMode = "automatic" | "review" | "manual";
type AutomationFrequency = "daily" | "weekly";

interface OnboardingAutomationItem {
  playbookId: string;
  title: string;
  agentId: string;
  purpose: string;
  enabled: boolean;
  frequency: AutomationFrequency;
  day: number;
  time: string;
}

interface OnboardingBrandFile {
  name: string;
  type: string;
  dataUrl: string;
}

type StepKey = OnboardingStep;

interface OnboardingDraft {
  workspaceMode: "local" | "cloud";
  companyName: string;
  websiteUrl: string;
  socials: Partial<Record<SocialPlatform, string>>;
  providerMode: "local" | "deployed";
  /** Null until the user explicitly picks an agent app, never defaulted. */
  provider: DriverType | null;
  /** Empty means the selected agent app chooses its model automatically. */
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
  analytics: {
    integrations: IntegrationSearchResult[];
  };
  ads: {
    integrations: IntegrationSearchResult[];
    /** Monthly spend the agents may plan toward if the user opts in. */
    budget: string;
  };
  aeo: {
    trackAiReferrals: boolean;
  };
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
  step: StepKey;
}

const steps = ONBOARDING_STEPS;

const questions: Record<StepKey, string> = {
  mode: "First, where should this workspace run?",
  inference: "Which agent app should Chief use?",
  health: "Quick check before we teach Chief about your business.",
  context:
    "I'll set this workspace up around one company, so the agents know exactly who they're working for. What's your company and website?",
  brand:
    "How should Chief learn your brand voice and visual guidelines for the initial review?",
  socials:
    "Nice. Now add the public accounts the agents should learn from and write for.",
  selling: "Describe what you're selling in a few short words.",
  audience: "Who is your ideal customer?",
  success: "What would make the next 90 days feel like this is working?",
  time: "How much time can you spend on marketing each week?",
  monitoring:
    "Where should your agents proactively search for prospects, buying signals and relevant conversations?",
  analytics: "Which analytics platforms do you use today?",
  ads: "Where do you run paid ads today?",
  adsBudget: "Roughly how much could you put toward paid ads each month?",
  aeo: "One last thing. Want to know when ChatGPT, Claude or Perplexity send you customers?",
  engineering: "Would you like Chief to make code changes to your website?",
  engineeringTools: "Which tools power your website?",
  automation:
    "Here is the recurring work I recommend starting with. Review the schedule, then activate what you want.",
  finish: "You're in.",
};

const successOptions = [
  "First paying customers",
  "Steady qualified leads",
  "A repeatable content rhythm",
  "$5k MRR with signal",
  "10 serious customer calls",
  "Repeatable acquisition channel",
];

const timeOptions = [
  "0-2 hours",
  "2-5 hours",
  "5-10 hours",
  "10-20 hours",
  "20+ hours",
];

const adsBudgetOptions = [
  "No budget yet",
  "$5 to $20 a month",
  "$20 to $50 a month",
  "$50 to $100 a month",
  "$100 to $300 a month",
  "$300 to $1,000 a month",
  "$1,000 to $3,000 a month",
  "$3,000+ a month",
];

const weekDays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const scheduleTimeOptions = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 === 0 ? "00" : "30";
  const value = `${String(hour).padStart(2, "0")}:${minute}`;
  const label = new Date(2000, 0, 1, hour, Number(minute)).toLocaleTimeString(
    [],
    { hour: "numeric", minute: "2-digit" },
  );
  return { value, label };
});

function defaultAutomationPlan(): OnboardingAutomationItem[] {
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

const monitoringOptions = [
  { key: "x", label: "X", platform: "x" as const, Icon: Twitter },
  { key: "facebook", label: "Facebook", Icon: Facebook },
  {
    key: "instagram",
    label: "Instagram",
    platform: "instagram" as const,
    Icon: Instagram,
  },
  {
    key: "reddit",
    label: "Reddit",
    platform: "reddit" as const,
    Icon: MessageCircle,
  },
  { key: "linkedin", label: "LinkedIn", Icon: Linkedin },
  {
    key: "youtube",
    label: "YouTube",
    platform: "youtube" as const,
    Icon: Youtube,
  },
  { key: "search", label: "Search", Icon: Search },
  { key: "communities", label: "Communities", Icon: Globe },
];

const fallbackAnalyticsIntegrations: IntegrationSearchResult[] = [
  {
    domain: "analytics.googleapis.com",
    name: "Google Analytics",
    description: "GA4 reporting through Google Analytics Admin and Data APIs.",
    kinds: ["openapi", "cli"],
    url: "https://integrations.sh/analytics.googleapis.com/",
  },
  {
    domain: "posthog.com",
    name: "PostHog",
    description:
      "Product analytics and event data through the PostHog MCP server.",
    kinds: ["mcp"],
    url: "https://integrations.sh/posthog.com/",
  },
  {
    domain: "pendo.io",
    name: "Pendo",
    description:
      "Product analytics and behavioral data through MCP and API surfaces.",
    kinds: ["mcp", "openapi"],
    url: "https://integrations.sh/pendo.io/",
  },
  {
    domain: "mixpanel.com",
    name: "Mixpanel",
    description:
      "Product analytics integration from the integrations.sh registry.",
    kinds: ["mcp"],
    url: "https://integrations.sh/mixpanel.com/",
  },
];

const fallbackAdsIntegrations: IntegrationSearchResult[] = [
  {
    domain: "googleads.googleapis.com",
    name: "Google Ads",
    description:
      "Google Ads campaign and conversion data through the Google Ads API.",
    kinds: ["openapi"],
    url: "https://integrations.sh/googleads.googleapis.com/",
  },
  {
    domain: "graph.facebook.com",
    name: "Meta Ads",
    description:
      "Meta campaign, ad set and ad performance data through the Graph API.",
    kinds: ["openapi"],
    url: "https://integrations.sh/graph.facebook.com/",
  },
  {
    domain: "api.linkedin.com",
    name: "LinkedIn Ads",
    description: "LinkedIn campaign and ad analytics through the LinkedIn API.",
    kinds: ["openapi"],
    url: "https://integrations.sh/api.linkedin.com/",
  },
  {
    domain: "business-api.tiktok.com",
    name: "TikTok Ads",
    description:
      "TikTok business campaign and reporting data through the Business API.",
    kinds: ["openapi"],
    url: "https://integrations.sh/business-api.tiktok.com/",
  },
];

const socialIcons: Partial<Record<SocialPlatform, SimpleIcon>> = {
  x: siX,
  instagram: siInstagram,
  tiktok: siTiktok,
  reddit: siReddit,
  youtube: siYoutube,
};

function BrandIcon({
  icon,
  label,
  className,
}: {
  icon?: SimpleIcon;
  label: string;
  className?: string;
}) {
  if (!icon) {
    return (
      <span
        className={cn(
          "bg-background text-muted-foreground flex h-6 w-6 items-center justify-center rounded-md border text-[10px]",
          className,
        )}
      >
        {label.slice(0, 1)}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "bg-background text-foreground flex h-6 w-6 items-center justify-center rounded-md border",
        className,
      )}
      aria-label={icon.title}
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
        <path fill="currentColor" d={icon.path} />
      </svg>
    </span>
  );
}

function storageKey(orgId: string) {
  return `chief-onboarding:${orgId}`;
}

function pendingStorageKey() {
  return storageKey("pending");
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = Math.random().toString(36).slice(2, 8);
  return base ? `${base}-${suffix}` : suffix;
}

function baseDraft(): OnboardingDraft {
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
    brand: {
      mode: "research",
      notes: "",
      files: [],
    },
    goals: {
      selling: "",
      audience: "",
      success: ["$5k MRR with signal"],
      timeBudget: "5-10 hours",
    },
    monitoring: {
      channels: ["X", "Reddit"],
      details: "",
      keywords: "",
    },
    analytics: {
      integrations: [],
    },
    ads: {
      integrations: [],
      budget: adsBudgetOptions[0]!,
    },
    aeo: {
      trackAiReferrals: true,
    },
    engineering: {
      enabled: null,
      integrations: [],
    },
    automation: {
      defaultsVersion: 2,
      mode: "automatic",
      timezone:
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        "Australia/Brisbane",
      plan: defaultAutomationPlan(),
    },
    step: "mode",
  };
}

function normaliseChannels(value: unknown, fallback: string[]) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return fallback;
}

function normaliseIntegrations(value: unknown): IntegrationSearchResult[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is IntegrationSearchResult => {
    if (!item || typeof item !== "object") return false;
    const integration = item as Partial<IntegrationSearchResult>;
    return (
      typeof integration.domain === "string" &&
      typeof integration.name === "string" &&
      typeof integration.description === "string" &&
      Array.isArray(integration.kinds) &&
      typeof integration.url === "string"
    );
  });
}

function normaliseAutomationPlan(value: unknown): OnboardingAutomationItem[] {
  const defaults = defaultAutomationPlan();
  if (!Array.isArray(value)) return defaults;
  return defaults.map((fallback) => {
    const saved = value.find(
      (item) =>
        item &&
        typeof item === "object" &&
        (item as { playbookId?: unknown }).playbookId === fallback.playbookId,
    ) as Partial<OnboardingAutomationItem> | undefined;
    const savedFrequency = (saved as { frequency?: unknown } | undefined)
      ?.frequency;
    return {
      ...fallback,
      enabled:
        typeof saved?.enabled === "boolean" ? saved.enabled : fallback.enabled,
      frequency:
        savedFrequency === "daily" || savedFrequency === "weekly"
          ? savedFrequency
          : savedFrequency === "weekdays"
            ? "daily"
            : fallback.frequency,
      day:
        typeof saved?.day === "number" && saved.day >= 0 && saved.day <= 6
          ? saved.day
          : fallback.day,
      time:
        typeof saved?.time === "string" && /^\d{2}:\d{2}$/.test(saved.time)
          ? saved.time
          : fallback.time,
    };
  });
}

function draftFromOrg(
  org: AuthOrganization,
  userName?: string,
): OnboardingDraft {
  const metadata = parseOrganizationMetadata(org);
  const onboarding =
    metadata.onboarding && typeof metadata.onboarding === "object"
      ? (metadata.onboarding as Record<string, unknown>)
      : {};
  const goals =
    onboarding.goals && typeof onboarding.goals === "object"
      ? (onboarding.goals as Record<string, unknown>)
      : {};
  const monitoring =
    onboarding.monitoring && typeof onboarding.monitoring === "object"
      ? (onboarding.monitoring as Record<string, unknown>)
      : {};
  const analytics =
    onboarding.analytics && typeof onboarding.analytics === "object"
      ? (onboarding.analytics as Partial<OnboardingDraft["analytics"]>)
      : {};
  const ads =
    onboarding.ads && typeof onboarding.ads === "object"
      ? (onboarding.ads as Partial<OnboardingDraft["ads"]>)
      : {};
  const aeo =
    onboarding.aeo && typeof onboarding.aeo === "object"
      ? (onboarding.aeo as Partial<OnboardingDraft["aeo"]>)
      : {};
  const engineering =
    onboarding.engineering && typeof onboarding.engineering === "object"
      ? (onboarding.engineering as Partial<OnboardingDraft["engineering"]>)
      : {};
  const brand =
    onboarding.brand && typeof onboarding.brand === "object"
      ? (onboarding.brand as Record<string, unknown>)
      : {};
  const automation =
    onboarding.automation && typeof onboarding.automation === "object"
      ? (onboarding.automation as Partial<OnboardingDraft["automation"]>)
      : {};
  const provider: DriverType | null =
    onboarding.provider === "claude" ||
    onboarding.provider === "codex" ||
    onboarding.provider === "opencode" ||
    onboarding.provider === "remote" ||
    onboarding.provider === "vercel"
      ? onboarding.provider === "vercel"
        ? "remote"
        : onboarding.provider
      : null;
  const looksLikePersonalOrg =
    typeof metadata.personalOrgUserId === "string" ||
    (userName?.trim() &&
      org.name.trim().toLowerCase() === userName.trim().toLowerCase());

  return {
    ...baseDraft(),
    workspaceMode:
      onboarding.workspaceMode === "cloud" ||
      onboarding.providerMode === "deployed"
        ? "cloud"
        : "local",
    companyName: looksLikePersonalOrg ? "" : org.name,
    websiteUrl:
      typeof metadata.websiteUrl === "string" ? metadata.websiteUrl : "",
    providerMode: onboarding.providerMode === "deployed" ? "deployed" : "local",
    provider,
    model: typeof onboarding.model === "string" ? onboarding.model : "",
    deploymentProvider:
      onboarding.deploymentProvider === "convex"
        ? "convex"
        : onboarding.deploymentProvider === "vercel" ||
            onboarding.provider === "vercel"
          ? "vercel"
          : null,
    cloudDeploymentUrl:
      typeof onboarding.cloudDeploymentUrl === "string"
        ? onboarding.cloudDeploymentUrl
        : "",
    brand: {
      mode:
        brand.mode === "upload" || brand.mode === "skip"
          ? brand.mode
          : "research",
      notes: typeof brand.notes === "string" ? brand.notes : "",
      files: [],
    },
    goals: {
      selling: typeof goals.selling === "string" ? goals.selling : "",
      audience: typeof goals.audience === "string" ? goals.audience : "",
      success: Array.isArray(goals.success)
        ? goals.success.filter(
            (item): item is string => typeof item === "string",
          )
        : typeof goals.success === "string"
          ? [goals.success]
          : ["$5k MRR with signal"],
      timeBudget:
        typeof goals.timeBudget === "string" ? goals.timeBudget : "5-10 hours",
    },
    monitoring: {
      channels: normaliseChannels(monitoring.channels, ["X", "Reddit"]),
      details: typeof monitoring.details === "string" ? monitoring.details : "",
      keywords:
        typeof monitoring.keywords === "string" ? monitoring.keywords : "",
    },
    analytics: {
      integrations: normaliseIntegrations(analytics.integrations),
    },
    ads: {
      integrations: normaliseIntegrations(ads.integrations),
      budget:
        typeof ads.budget === "string" && ads.budget
          ? ads.budget
          : adsBudgetOptions[0]!,
    },
    aeo: {
      trackAiReferrals:
        typeof aeo.trackAiReferrals === "boolean" ? aeo.trackAiReferrals : true,
    },
    engineering: {
      enabled:
        typeof engineering.enabled === "boolean" ? engineering.enabled : null,
      integrations: normaliseIntegrations(engineering.integrations),
    },
    automation: {
      defaultsVersion: 2,
      mode:
        automation.mode === "automatic" || automation.mode === "manual"
          ? automation.mode
          : automation.mode === "review" && automation.defaultsVersion === 2
            ? "review"
            : "automatic",
      timezone:
        typeof automation.timezone === "string" && automation.timezone
          ? automation.timezone
          : baseDraft().automation.timezone,
      plan: normaliseAutomationPlan(automation.plan),
    },
    step: typeof onboarding.completedAt === "string" ? "finish" : "mode",
  };
}

function loadStoredDraft(base: OnboardingDraft, key: string): OnboardingDraft {
  try {
    const legacyKey = key.replace(/^chief-onboarding:/, "marketer-onboarding:");
    const stored = localStorage.getItem(key) ?? localStorage.getItem(legacyKey);
    if (!stored) return base;
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, stored);
      localStorage.removeItem(legacyKey);
    }
    const parsed = JSON.parse(stored) as Partial<OnboardingDraft>;
    const hasSetupMode =
      parsed.workspaceMode === "local" || parsed.workspaceMode === "cloud";
    const parsedMonitoring = parsed.monitoring as
      Partial<OnboardingDraft["monitoring"]> | undefined;
    const parsedAnalytics = parsed.analytics as
      Partial<OnboardingDraft["analytics"]> | undefined;
    const parsedAds = parsed.ads as Partial<OnboardingDraft["ads"]> | undefined;
    const parsedAeo = parsed.aeo as Partial<OnboardingDraft["aeo"]> | undefined;
    const parsedEngineering = parsed.engineering as
      Partial<OnboardingDraft["engineering"]> | undefined;
    const parsedBrand = parsed.brand as
      Partial<OnboardingDraft["brand"]> | undefined;
    const parsedAutomation = parsed.automation as
      Partial<OnboardingDraft["automation"]> | undefined;
    const parsedProvider = (parsed as { provider?: unknown }).provider;
    const storedStep = (parsed as { step?: string }).step;
    return {
      ...base,
      ...parsed,
      workspaceMode:
        parsed.workspaceMode === "cloud" || parsed.providerMode === "deployed"
          ? "cloud"
          : "local",
      companyName: parsed.companyName ?? base.companyName,
      websiteUrl: parsed.websiteUrl ?? base.websiteUrl,
      socials: { ...base.socials, ...(parsed.socials ?? {}) },
      providerMode: parsed.providerMode === "deployed" ? "deployed" : "local",
      provider:
        parsedProvider === "claude" ||
        parsedProvider === "codex" ||
        parsedProvider === "opencode" ||
        parsedProvider === "remote" ||
        parsedProvider === "vercel"
          ? parsedProvider === "vercel"
            ? "remote"
            : parsedProvider
          : base.provider,
      model: typeof parsed.model === "string" ? parsed.model : base.model,
      deploymentProvider:
        parsed.deploymentProvider === "convex"
          ? "convex"
          : parsed.deploymentProvider === "vercel" ||
              parsedProvider === "vercel"
            ? "vercel"
            : base.deploymentProvider,
      cloudDeploymentUrl: parsed.cloudDeploymentUrl ?? base.cloudDeploymentUrl,
      brand: {
        mode:
          parsedBrand?.mode === "upload" || parsedBrand?.mode === "skip"
            ? parsedBrand.mode
            : base.brand.mode,
        notes:
          typeof parsedBrand?.notes === "string"
            ? parsedBrand.notes
            : base.brand.notes,
        files: Array.isArray(parsedBrand?.files)
          ? parsedBrand.files.filter((file): file is OnboardingBrandFile =>
              Boolean(
                file &&
                typeof file.name === "string" &&
                typeof file.type === "string" &&
                typeof file.dataUrl === "string",
              ),
            )
          : [],
      },
      goals: {
        ...base.goals,
        ...(parsed.goals ?? {}),
        success: Array.isArray(parsed.goals?.success)
          ? parsed.goals.success.filter(
              (item): item is string => typeof item === "string",
            )
          : typeof parsed.goals?.success === "string"
            ? [parsed.goals.success]
            : base.goals.success,
      },
      monitoring: {
        ...base.monitoring,
        ...(parsed.monitoring ?? {}),
        channels: normaliseChannels(
          parsedMonitoring?.channels,
          base.monitoring.channels,
        ),
      },
      analytics: {
        integrations: normaliseIntegrations(parsedAnalytics?.integrations),
      },
      ads: {
        integrations: normaliseIntegrations(parsedAds?.integrations),
        budget:
          typeof parsedAds?.budget === "string" && parsedAds.budget
            ? parsedAds.budget
            : base.ads.budget,
      },
      aeo: {
        ...base.aeo,
        ...(parsedAeo ?? {}),
        trackAiReferrals:
          typeof parsedAeo?.trackAiReferrals === "boolean"
            ? parsedAeo.trackAiReferrals
            : base.aeo.trackAiReferrals,
      },
      engineering: {
        enabled:
          typeof parsedEngineering?.enabled === "boolean"
            ? parsedEngineering.enabled
            : base.engineering.enabled,
        integrations: normaliseIntegrations(parsedEngineering?.integrations),
      },
      automation: {
        defaultsVersion: 2,
        mode:
          parsedAutomation?.mode === "automatic" ||
          parsedAutomation?.mode === "manual"
            ? parsedAutomation.mode
            : parsedAutomation?.mode === "review" &&
                parsedAutomation.defaultsVersion === 2
              ? "review"
              : base.automation.mode,
        timezone:
          typeof parsedAutomation?.timezone === "string" &&
          parsedAutomation.timezone
            ? parsedAutomation.timezone
            : base.automation.timezone,
        plan: normaliseAutomationPlan(parsedAutomation?.plan),
      },
      step:
        storedStep === "analyticsConnect"
          ? "ads"
          : storedStep === "adsConnect"
            ? normaliseIntegrations(parsedAds?.integrations).length > 0
              ? "aeo"
              : "adsBudget"
            : parsed.step && steps.includes(parsed.step) && hasSetupMode
              ? parsed.step
              : base.step,
    };
  } catch {
    return base;
  }
}

function loadDraft(org: AuthOrganization, userName?: string): OnboardingDraft {
  return loadStoredDraft(draftFromOrg(org, userName), storageKey(org.id));
}

function loadPendingDraft(): OnboardingDraft {
  return loadStoredDraft(baseDraft(), pendingStorageKey());
}

function useTypedQuestion(text: string, active: boolean) {
  const [visible, setVisible] = useState(() => (active ? "" : text));
  const [complete, setComplete] = useState(!active);

  useEffect(() => {
    if (!active) {
      setVisible(text);
      setComplete(true);
      return;
    }
    let index = 0;
    setVisible("");
    setComplete(false);
    const timer = window.setInterval(() => {
      index += 1;
      setVisible(text.slice(0, index));
      if (index >= text.length) {
        window.clearInterval(timer);
        setComplete(true);
      }
    }, 18);
    return () => window.clearInterval(timer);
  }, [active, text]);

  return { visible, complete };
}

function AgentBubble({ text, current }: { text: string; current?: boolean }) {
  const typed = useTypedQuestion(text, Boolean(current));
  return (
    <div className="flex justify-start">
      <div className="text-foreground max-w-[680px] text-[15px] leading-7">
        {current ? typed.visible : text}
        {current && !typed.complete ? (
          <span className="bg-foreground ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-pulse" />
        ) : null}
      </div>
    </div>
  );
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="bg-muted/40 text-foreground max-w-[620px] rounded-xl border px-3 py-2 text-sm leading-6">
        {children}
      </div>
    </div>
  );
}

function EditableAnswer({
  children,
  onEdit,
}: {
  children: React.ReactNode;
  onEdit: () => void;
}) {
  return (
    <div className="group/answer flex flex-col items-end gap-1.5">
      {children}
      <button
        type="button"
        onClick={onEdit}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11px] opacity-0 transition-[color,opacity] group-hover/answer:opacity-100 focus-visible:opacity-100"
      >
        <Pencil size={10} />
        Edit
      </button>
    </div>
  );
}

function UserIndicator({
  user,
  onSignOut,
}: {
  user: {
    name: string;
    email: string;
    image?: string;
  } | null;
  onSignOut: () => void;
}) {
  if (!user) return null;
  const label = user.name?.trim() || user.email;
  const initial = label.charAt(0).toUpperCase();

  return (
    <div className="fixed top-10 left-4 z-50 flex items-center gap-2">
      <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full border text-[11px] font-medium">
        {user.image ? (
          <img src={user.image} alt="" className="h-full w-full object-cover" />
        ) : (
          initial
        )}
      </span>
      <span className="text-muted-foreground max-w-[180px] truncate text-[13px]">
        {label}
      </span>
      <span className="text-muted-foreground/40 text-[13px]">·</span>
      <button
        type="button"
        onClick={onSignOut}
        className="text-muted-foreground hover:text-foreground cursor-pointer text-[13px] transition-colors"
      >
        Sign out
      </button>
    </div>
  );
}

function SocialIcon({
  label,
  platform,
}: {
  label: string;
  platform?: SocialPlatform;
}) {
  return (
    <BrandIcon
      icon={platform ? socialIcons[platform] : undefined}
      label={label}
    />
  );
}

function selectedIntegrationNames(integrations: IntegrationSearchResult[]) {
  return integrations.length
    ? integrations.map((integration) => integration.name).join(", ")
    : null;
}

function modeLabel(draft: OnboardingDraft) {
  return draft.workspaceMode === "cloud" ? "Cloud workspace" : "This Mac";
}

function questionText(step: StepKey, draft: OnboardingDraft) {
  if (step === "inference" && draft.workspaceMode === "cloud") {
    return "Which cloud provider should Chief use?";
  }
  if (step === "adsBudget" && draft.ads.integrations.length > 0) {
    return "Roughly how much do you spend on paid ads each month?";
  }
  return questions[step];
}

function AnswerPreview({
  step,
  draft,
}: {
  step: StepKey;
  draft: OnboardingDraft;
}) {
  if (step === "mode") {
    return (
      <UserBubble>
        <span className="block font-medium">{modeLabel(draft)}</span>
        <span className="text-muted-foreground">
          {draft.workspaceMode === "cloud"
            ? "A dedicated cloud workspace can keep working when your Mac is closed."
            : "Agents use this computer and your existing local agent apps."}
        </span>
      </UserBubble>
    );
  }

  if (step === "health") {
    return <UserBubble>Workspace readiness checked</UserBubble>;
  }

  if (step === "context") {
    return (
      <UserBubble>
        <span className="block font-medium">{draft.companyName}</span>
        <span className="text-muted-foreground">{draft.websiteUrl}</span>
      </UserBubble>
    );
  }

  if (step === "brand") {
    return (
      <UserBubble>
        <span className="block font-medium">
          {draft.brand.mode === "research"
            ? "Build it from our website"
            : draft.brand.mode === "upload"
              ? "Use our brand kit"
              : "Skip for now"}
        </span>
        {draft.brand.files.length > 0 ? (
          <span className="text-muted-foreground mt-1 block">
            {draft.brand.files.map((file) => file.name).join(", ")}
          </span>
        ) : null}
      </UserBubble>
    );
  }

  if (step === "socials") {
    const selected = SOCIAL_PLATFORMS.filter(
      (def) => draft.socials[def.platform],
    );
    return (
      <UserBubble>
        {selected.length ? (
          <div className="flex flex-wrap gap-2">
            {selected.map((def) => (
              <span
                key={def.platform}
                className="bg-background inline-flex items-center gap-2 rounded-lg border px-2 py-1"
              >
                <SocialIcon label={def.label} platform={def.platform} />
                {def.prefix}
                {draft.socials[def.platform]}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">No social accounts yet</span>
        )}
      </UserBubble>
    );
  }

  if (step === "inference") {
    const label =
      draft.providerMode === "deployed"
        ? draft.deploymentProvider === "convex"
          ? "Convex"
          : draft.deploymentProvider === "vercel"
            ? "Vercel"
            : "Cloud deployment"
        : draft.provider === "codex"
          ? "Codex"
          : draft.provider === "claude"
            ? "Claude"
            : draft.provider === "opencode"
              ? "OpenCode"
              : "Not chosen yet";
    return <UserBubble>{label}</UserBubble>;
  }

  if (step === "selling") {
    return <UserBubble>{draft.goals.selling || "Product not set"}</UserBubble>;
  }

  if (step === "audience") {
    return (
      <UserBubble>{draft.goals.audience || "Audience not set"}</UserBubble>
    );
  }

  if (step === "success") {
    return <UserBubble>{draft.goals.success.join(", ")}</UserBubble>;
  }
  if (step === "time") return <UserBubble>{draft.goals.timeBudget}</UserBubble>;

  if (step === "monitoring") {
    return (
      <UserBubble>
        <div className="flex flex-wrap gap-2">
          {draft.monitoring.channels.map((channel) => (
            <span
              key={channel}
              className="bg-background rounded-lg border px-2 py-1"
            >
              {channel}
            </span>
          ))}
        </div>
        {draft.monitoring.keywords || draft.monitoring.details ? (
          <p className="text-muted-foreground mt-2">
            {draft.monitoring.keywords || draft.monitoring.details}
          </p>
        ) : null}
      </UserBubble>
    );
  }

  if (step === "analytics") {
    return (
      <UserBubble>
        {selectedIntegrationNames(draft.analytics.integrations) ??
          "No analytics yet"}
      </UserBubble>
    );
  }

  if (step === "ads") {
    return (
      <UserBubble>
        {selectedIntegrationNames(draft.ads.integrations) ?? "No paid ads"}
      </UserBubble>
    );
  }

  if (step === "adsBudget") {
    return <UserBubble>{draft.ads.budget}</UserBubble>;
  }

  if (step === "aeo") {
    return (
      <UserBubble>
        {draft.aeo.trackAiReferrals ? "Track AI referrals" : "Not now"}
      </UserBubble>
    );
  }

  if (step === "engineering") {
    return (
      <UserBubble>
        {draft.engineering.enabled
          ? "Yes, help with technical setup"
          : "Not right now"}
      </UserBubble>
    );
  }

  if (step === "engineeringTools") {
    return (
      <UserBubble>
        {selectedIntegrationNames(draft.engineering.integrations) ??
          "No engineering tools selected"}
      </UserBubble>
    );
  }

  if (step === "automation") {
    const enabled = draft.automation.plan.filter((item) => item.enabled);
    const modeLabel =
      draft.automation.mode === "automatic"
        ? "Activate automatically"
        : draft.automation.mode === "review"
          ? "Review in Schedule"
          : "Not now";
    return (
      <UserBubble>
        <span className="block font-medium">{modeLabel}</span>
        {enabled.length > 0 && draft.automation.mode !== "manual" ? (
          <span className="text-muted-foreground mt-1 block">
            {enabled.map((item) => item.title).join(", ")}
          </span>
        ) : null}
      </UserBubble>
    );
  }

  return null;
}

function ModeControl({
  draft,
  setField,
  onContinue,
  saving,
}: {
  draft: OnboardingDraft;
  setField: (patch: Partial<OnboardingDraft>) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  const selectMode = (workspaceMode: OnboardingDraft["workspaceMode"]) => {
    if (workspaceMode === "cloud") {
      setField({
        workspaceMode,
        providerMode: "deployed",
        provider: "remote",
      });
      return;
    }

    setField({
      workspaceMode,
      providerMode: "local",
      // Keep an already-made local choice; clear a cloud one. Never assume.
      provider: draft.provider === "remote" ? null : draft.provider,
      deploymentProvider: null,
      cloudDeploymentUrl: "",
    });
  };

  const cardClass = (selected: boolean) =>
    cn(
      "bg-background hover:border-foreground rounded-xl border p-4 text-left transition-colors",
      selected && "border-foreground bg-muted",
    );

  return (
    <StepFrame onContinue={onContinue} saving={saving}>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          className={cardClass(draft.workspaceMode === "local")}
          onClick={() => selectMode("local")}
        >
          <div className="flex items-start gap-3">
            <span className="bg-background flex size-8 shrink-0 items-center justify-center rounded-lg border">
              <Laptop size={16} />
            </span>
            <span>
              <span className="block text-sm font-medium">This Mac</span>
              <span className="text-muted-foreground mt-1 block text-xs leading-5">
                Use the Claude or Codex app you already have. Good when you want
                work, data and connector secrets to stay close to this machine.
              </span>
            </span>
          </div>
        </button>

        <button
          type="button"
          className={cardClass(draft.workspaceMode === "cloud")}
          onClick={() => selectMode("cloud")}
        >
          <div className="flex items-start gap-3">
            <span className="bg-background flex size-8 shrink-0 items-center justify-center rounded-lg border">
              <Cloud size={16} />
            </span>
            <span>
              <span className="block text-sm font-medium">Cloud workspace</span>
              <span className="text-muted-foreground mt-1 block text-xs leading-5">
                Deploy the agent workspace to Vercel or Convex so it can
                continue working while your Mac is offline.
              </span>
            </span>
          </div>
        </button>
      </div>
    </StepFrame>
  );
}

function ContextControl({
  draft,
  setField,
  onContinue,
  saving,
}: {
  draft: OnboardingDraft;
  setField: (patch: Partial<OnboardingDraft>) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  return (
    <StepFrame
      onContinue={onContinue}
      saving={saving}
      disabled={!draft.companyName.trim()}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-muted-foreground text-xs">Company</span>
          <Input
            autoFocus
            value={draft.companyName}
            onChange={(event) => setField({ companyName: event.target.value })}
            placeholder="Acme"
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-muted-foreground text-xs">Website</span>
          <Input
            value={draft.websiteUrl}
            onChange={(event) => setField({ websiteUrl: event.target.value })}
            placeholder="acme.com"
          />
        </label>
      </div>
    </StepFrame>
  );
}

function BrandControl({
  draft,
  setBrand,
  onContinue,
  saving,
}: {
  draft: OnboardingDraft;
  setBrand: (patch: Partial<OnboardingDraft["brand"]>) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  const [fileError, setFileError] = useState<string | null>(null);
  const choices: {
    mode: OnboardingDraft["brand"]["mode"];
    label: string;
    detail: string;
  }[] = [
    {
      mode: "research",
      label: "Build it for me",
      detail:
        "Chief will study your website and public profiles in the initial review.",
    },
    {
      mode: "upload",
      label: "I have a brand kit",
      detail: "Add guidelines, examples, logos or reference material.",
    },
    {
      mode: "skip",
      label: "Not yet",
      detail: "Continue without a saved brand profile.",
    },
  ];

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const selected = Array.from(files).slice(0, 4);
    const totalBytes = selected.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > 4 * 1024 * 1024) {
      setFileError("Keep the selected files under 4 MB in total.");
      return;
    }
    setFileError(null);
    const encoded = await Promise.all(
      selected.map(
        (file) =>
          new Promise<OnboardingBrandFile>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                name: file.name,
                type: file.type || "application/octet-stream",
                dataUrl: String(reader.result ?? ""),
              });
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          }),
      ),
    );
    setBrand({ mode: "upload", files: encoded });
  };

  return (
    <StepFrame onContinue={onContinue} saving={saving}>
      <div className="grid gap-2 sm:grid-cols-3">
        {choices.map((choice) => (
          <button
            key={choice.mode}
            type="button"
            onClick={() => setBrand({ mode: choice.mode })}
            className={cn(
              "bg-background hover:border-foreground rounded-xl border p-3 text-left transition-colors",
              draft.brand.mode === choice.mode && "border-foreground bg-accent",
            )}
          >
            <span className="block text-xs font-medium">{choice.label}</span>
            <span className="text-muted-foreground mt-1 block text-[10px] leading-4">
              {choice.detail}
            </span>
          </button>
        ))}
      </div>
      {draft.brand.mode !== "skip" ? (
        <div className="bg-background mt-4 rounded-xl border p-4">
          <label className="text-xs font-medium" htmlFor="brand-notes">
            Anything the agent should preserve
          </label>
          <textarea
            id="brand-notes"
            value={draft.brand.notes}
            onChange={(event) => setBrand({ notes: event.target.value })}
            placeholder="Claims, phrases, visual rules, examples or links"
            className="bg-background placeholder:text-muted-foreground focus:border-foreground mt-2 min-h-20 w-full resize-y rounded-lg border px-3 py-2 text-xs leading-5 outline-none"
          />
          {draft.brand.mode === "upload" ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="bg-foreground text-background hover:bg-foreground/90 inline-flex h-8 cursor-pointer items-center rounded-lg border px-3 text-xs">
                Add files
                <input
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.txt,.md,.json,image/*"
                  className="hidden"
                  onChange={(event) => void addFiles(event.target.files)}
                />
              </label>
              <span className="text-muted-foreground text-[10px]">
                Up to four files, 4 MB total
              </span>
            </div>
          ) : null}
          {draft.brand.files.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {draft.brand.files.map((file) => (
                <span
                  key={file.name}
                  className="text-muted-foreground rounded-md border px-2 py-1 text-[10px]"
                >
                  {file.name}
                </span>
              ))}
            </div>
          ) : null}
          {fileError ? (
            <p className="text-destructive mt-2 text-[10px]">{fileError}</p>
          ) : null}
        </div>
      ) : null}
      <p className="text-muted-foreground mt-3 text-[10px] leading-4">
        Chief uses this during the initial business review after onboarding.
      </p>
    </StepFrame>
  );
}

function SocialsControl({
  draft,
  setSocial,
  onContinue,
  saving,
  ready,
}: {
  draft: OnboardingDraft;
  setSocial: (platform: SocialPlatform, handle: string) => void;
  onContinue: () => void;
  saving: boolean;
  ready: boolean;
}) {
  return (
    <StepFrame onContinue={onContinue} saving={saving} disabled={!ready}>
      <div className="grid gap-3">
        {SOCIAL_PLATFORMS.map((def) => (
          <label
            key={def.platform}
            className="grid gap-2 sm:grid-cols-[7rem_1fr] sm:items-center"
          >
            <span className="text-muted-foreground inline-flex items-center gap-2 text-xs">
              <SocialIcon label={def.label} platform={def.platform} />
              {def.label}
            </span>
            <PrefixedInput
              className="overflow-hidden rounded-lg"
              prefix={def.prefix}
              value={draft.socials[def.platform] ?? ""}
              onValueChange={(handle) => setSocial(def.platform, handle)}
              placeholder="handle"
              disabled={!ready}
            />
          </label>
        ))}
      </div>
    </StepFrame>
  );
}

function ProviderControl({
  draft,
  setField,
  gatewayConfigured,
  deploymentReady,
  saveGatewayKey,
  onChangeLocation,
  onContinue,
  saving,
}: {
  draft: OnboardingDraft;
  setField: (patch: Partial<OnboardingDraft>) => void;
  gatewayConfigured: boolean | null;
  deploymentReady: boolean;
  saveGatewayKey: (value: string) => void;
  onChangeLocation: () => void;
  onContinue: () => void;
  saving: boolean;
}) {
  const [gatewayKey, setGatewayKey] = useState("");
  const optionClass = (selected: boolean) =>
    cn(
      "bg-background hover:border-foreground flex min-h-[112px] items-start gap-3 rounded-xl border p-4 text-left transition-colors",
      selected && "border-foreground bg-muted",
    );

  if (draft.workspaceMode === "cloud") {
    return (
      <StepFrame
        onContinue={onContinue}
        saving={saving}
        disabled={
          !deploymentReady ||
          !draft.deploymentProvider ||
          (draft.deploymentProvider === "convex" && !gatewayConfigured)
        }
        continueLabel="Connect and deploy"
        actionsLeft={
          <Button type="button" variant="ghost" onClick={onChangeLocation}>
            Back
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() =>
              setField({
                providerMode: "deployed",
                provider: "remote",
                deploymentProvider: "vercel",
              })
            }
            className={optionClass(draft.deploymentProvider === "vercel")}
          >
            <Vercel size={18} className="mt-0.5 shrink-0" />
            <span>
              <span className="block text-sm font-medium">Vercel</span>
              <span className="text-muted-foreground mt-1 block text-xs leading-5">
                Sign in with Vercel, create a dedicated project, and deploy Eve
                with live build output.
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() =>
              setField({
                providerMode: "deployed",
                provider: "remote",
                deploymentProvider: "convex",
              })
            }
            className={optionClass(draft.deploymentProvider === "convex")}
          >
            <ConvexLogo size={18} className="mt-0.5 shrink-0" />
            <span>
              <span className="block text-sm font-medium">Convex</span>
              <span className="text-muted-foreground mt-1 block text-xs leading-5">
                Deploy Chief sessions and durable event streams into a dedicated
                Convex project.
              </span>
            </span>
          </button>
        </div>
        {!deploymentReady ? (
          <p className="text-muted-foreground mt-3 text-xs">
            Starting Chief's local deployment service...
          </p>
        ) : null}
        {draft.deploymentProvider === "convex" ? (
          <div className="bg-background mt-3 rounded-xl border p-4">
            {gatewayConfigured === null ? (
              <p className="text-muted-foreground text-xs">
                Checking this workspace's Keychain vault...
              </p>
            ) : gatewayConfigured ? (
              <p className="text-xs text-emerald-500">
                AI Gateway key stored in this workspace's Keychain vault.
              </p>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium">AI Gateway key</p>
                  <p className="text-muted-foreground mt-1 text-xs leading-5">
                    Convex needs a Vercel AI Gateway API key to run Chief's
                    model. The value is sent straight to the local runtime and
                    stored in macOS Keychain, never in onboarding metadata.{" "}
                    <a
                      href={AI_GATEWAY_KEYS_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground underline underline-offset-2"
                    >
                      Create a key in Vercel
                    </a>
                    .
                  </p>
                </div>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={gatewayKey}
                    autoComplete="off"
                    placeholder="AI Gateway API key"
                    onChange={(event) => setGatewayKey(event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!gatewayKey}
                    onClick={() => {
                      saveGatewayKey(gatewayKey);
                      setGatewayKey("");
                    }}
                  >
                    Save key
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </StepFrame>
    );
  }

  return (
    <StepFrame
      onContinue={onContinue}
      saving={saving}
      disabled={
        draft.provider !== "claude" &&
        draft.provider !== "codex" &&
        draft.provider !== "opencode"
      }
      actionsLeft={
        <Button type="button" variant="ghost" onClick={onChangeLocation}>
          Back
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() =>
            setField({ providerMode: "local", provider: "claude", model: "" })
          }
          className={optionClass(
            draft.providerMode === "local" && draft.provider === "claude",
          )}
        >
          <Claude.Color size={18} className="mt-0.5 shrink-0" />
          <span>
            <span className="block text-sm font-medium">Claude</span>
            <span className="text-muted-foreground mt-1 block text-xs leading-5">
              Uses your existing Claude subscription on this Mac. Good for
              strategy, research and writing work.
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() =>
            setField({ providerMode: "local", provider: "codex", model: "" })
          }
          className={optionClass(
            draft.providerMode === "local" && draft.provider === "codex",
          )}
        >
          <OpenAI size={18} className="mt-0.5 shrink-0" />
          <span>
            <span className="block text-sm font-medium">Codex</span>
            <span className="text-muted-foreground mt-1 block text-xs leading-5">
              Uses your existing Codex setup. Good when the agent needs to work
              in repos, files and local tools.
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() =>
            setField({
              providerMode: "local",
              provider: "opencode",
              model: "",
            })
          }
          className={optionClass(
            draft.providerMode === "local" && draft.provider === "opencode",
          )}
        >
          <OpenCode size={18} className="mt-0.5 shrink-0" />
          <span>
            <span className="block text-sm font-medium">OpenCode</span>
            <span className="text-muted-foreground mt-1 block text-xs leading-5">
              Uses your existing OpenCode setup on this Mac. Open and flexible
              for general agent work in any project.
            </span>
          </span>
        </button>
      </div>
    </StepFrame>
  );
}

function ReadinessRow({
  icon: Icon,
  label,
  detail,
  ready,
}: {
  icon: typeof Server;
  label: string;
  detail: ReactNode;
  ready: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center",
          ready ? "text-emerald-500" : "text-muted-foreground",
        )}
      >
        {ready ? <CheckCircle2 size={15} /> : <Icon size={15} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="text-muted-foreground mt-1 block text-xs leading-5">
          {detail}
        </span>
      </span>
    </div>
  );
}

function HealthControl({
  draft,
  runtimeStatus,
  convexReady,
  deployment,
  deploymentProvider,
  onBack,
  onRetryDeployment,
  onCancelDeployment,
  onChangeProvider,
  onUseLocal,
  onModelChange,
  onContinue,
  saving,
}: {
  draft: OnboardingDraft;
  runtimeStatus: "connecting" | "connected" | "disconnected";
  convexReady: boolean;
  deployment?: AgentDeploymentRecord;
  deploymentProvider: AgentDeploymentTarget | null;
  onBack: () => void;
  onRetryDeployment: () => void;
  onCancelDeployment: () => void;
  onChangeProvider: () => void;
  onUseLocal: () => void;
  onModelChange: (model: string) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  const providerModels = useProviderModels(
    draft.workspaceMode === "local" ? draft.provider : null,
  );
  const providerLabel =
    draft.workspaceMode === "cloud"
      ? deploymentProvider === "convex"
        ? "Convex deployment"
        : "Vercel deployment"
      : draft.provider === "codex"
        ? "Codex on this Mac"
        : draft.provider === "claude"
          ? "Claude on this Mac"
          : draft.provider === "opencode"
            ? "OpenCode on this Mac"
            : "No agent app chosen yet";
  const runtimeReady =
    draft.workspaceMode === "cloud"
      ? deployment?.status === "ready"
      : runtimeStatus === "connected";
  const selectedModelLabel =
    providerModels.models.find((model) => model.value === draft.model)?.label ??
    (draft.model || "Auto");

  if (draft.workspaceMode === "cloud") {
    const running = deployment?.status === "running";
    return (
      <StepFrame
        onContinue={onContinue}
        saving={saving}
        disabled={!runtimeReady}
        continueLabel={runtimeReady ? "Continue onboarding" : "Deploying..."}
        actionsLeft={
          <>
            {running ? (
              <Button
                type="button"
                variant="outline"
                onClick={onCancelDeployment}
              >
                Cancel
              </Button>
            ) : deployment?.status !== "ready" ? (
              <Button
                type="button"
                variant="outline"
                onClick={onRetryDeployment}
              >
                Retry deployment
              </Button>
            ) : null}
            {!running ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onChangeProvider}
                >
                  Change provider
                </Button>
                <Button type="button" variant="ghost" onClick={onUseLocal}>
                  Use this Mac
                </Button>
              </>
            ) : null}
          </>
        }
      >
        <div className="bg-background overflow-hidden rounded-xl border">
          <div className="flex items-start gap-3 border-b px-4 py-3">
            {deploymentProvider === "convex" ? (
              <ConvexLogo size={18} className="mt-0.5 shrink-0" />
            ) : (
              <Vercel size={18} className="mt-0.5 shrink-0" />
            )}
            <span
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                deployment?.status === "ready"
                  ? "bg-emerald-500"
                  : deployment?.status === "failed" ||
                      deployment?.status === "needs_configuration"
                    ? "bg-red-500"
                    : deployment?.status === "canceled"
                      ? "bg-muted-foreground/40"
                      : "animate-pulse bg-blue-500",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">
                {deployment?.phase
                  ? deployment.phase.charAt(0).toUpperCase() +
                    deployment.phase.slice(1)
                  : deployment?.status === "ready"
                    ? "Agent is live"
                    : "Preparing deployment"}
              </span>
              <span className="text-muted-foreground mt-1 block text-xs leading-5">
                {deployment?.detail ??
                  `Connecting ${deploymentProvider ?? "cloud provider"}.`}
              </span>
              {deployment?.url ? (
                <span className="text-muted-foreground mt-1 block truncate font-mono text-[10px]">
                  {deployment.url}
                </span>
              ) : null}
            </span>
          </div>
          <div className="h-64 overflow-y-auto bg-black/30 px-4 py-3 font-mono text-[10px] leading-5">
            {deployment?.logs.length ? (
              deployment.logs.map((line, index) => (
                <p key={`${index}-${line}`} className="break-all">
                  {line}
                </p>
              ))
            ) : (
              <p className="text-muted-foreground">
                Waiting for deployment output...
              </p>
            )}
          </div>
        </div>
      </StepFrame>
    );
  }

  return (
    <StepFrame
      onContinue={onContinue}
      saving={saving}
      continueLabel="Continue onboarding"
      actionsLeft={
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
      }
    >
      <div className="bg-background divide-y overflow-hidden rounded-xl border px-4">
        <ReadinessRow
          icon={Server}
          label="Account"
          detail={
            convexReady
              ? "Signed in and ready to save setup."
              : "Still connecting to your account."
          }
          ready={convexReady}
        />
        <ReadinessRow
          icon={Laptop}
          label={modeLabel(draft)}
          detail={
            runtimeStatus === "connected"
              ? "The local agent service is reachable."
              : "The local agent service is starting or reconnecting."
          }
          ready={runtimeReady}
        />
        <ReadinessRow
          icon={Server}
          label="Agent app"
          detail={
            <span className="flex flex-wrap items-center gap-2">
              <span>{providerLabel}</span>
              <Select
                value={draft.model || "auto"}
                onValueChange={(value) =>
                  onModelChange(value === "auto" ? "" : value)
                }
              >
                <SelectTrigger
                  className="h-7 w-auto min-w-32 px-2 text-xs"
                  aria-label="Initial review model"
                >
                  {providerModels.loading && providerModels.models.length === 0
                    ? "Loading models..."
                    : selectedModelLabel}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  {providerModels.models
                    .filter((model) => model.value.toLowerCase() !== "auto")
                    .map((model) => (
                      <SelectItem key={model.value} value={model.value}>
                        {model.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </span>
          }
          ready={
            draft.provider === "claude" ||
            draft.provider === "codex" ||
            draft.provider === "opencode"
          }
        />
      </div>
      {!runtimeReady ? (
        <p className="text-muted-foreground mt-4 text-xs leading-5">
          You can finish onboarding while the agent connection comes online.
          Chief will not start the review before onboarding is complete.
        </p>
      ) : null}
    </StepFrame>
  );
}

function SellingControl({
  draft,
  setGoals,
  onContinue,
  saving,
}: {
  draft: OnboardingDraft;
  setGoals: (patch: Partial<OnboardingDraft["goals"]>) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  return (
    <StepFrame
      onContinue={onContinue}
      saving={saving}
      disabled={!draft.goals.selling.trim()}
    >
      <Input
        autoFocus
        value={draft.goals.selling}
        onChange={(event) => setGoals({ selling: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter" && draft.goals.selling.trim()) {
            void onContinue();
          }
        }}
        placeholder="AI marketing agents for early-stage teams"
      />
      <p className="text-muted-foreground mt-3 text-xs leading-5">
        Keep it short. The agents use this as the plain-English version of the
        offer.
      </p>
    </StepFrame>
  );
}

function AudienceControl({
  draft,
  setGoals,
  onContinue,
  saving,
}: {
  draft: OnboardingDraft;
  setGoals: (patch: Partial<OnboardingDraft["goals"]>) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  return (
    <StepFrame
      onContinue={onContinue}
      saving={saving}
      disabled={!draft.goals.audience.trim()}
    >
      <Input
        autoFocus
        value={draft.goals.audience}
        onChange={(event) => setGoals({ audience: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter" && draft.goals.audience.trim()) {
            void onContinue();
          }
        }}
        placeholder="Solo founders who need pipeline but hate manual outreach"
      />
      <p className="text-muted-foreground mt-3 text-xs leading-5">
        A real person or team type is better than a market category.
      </p>
    </StepFrame>
  );
}

function SuccessControl({
  draft,
  setGoals,
  onContinue,
  saving,
}: {
  draft: OnboardingDraft;
  setGoals: (patch: Partial<OnboardingDraft["goals"]>) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  const customValue =
    draft.goals.success.find((item) => !successOptions.includes(item)) ?? "";
  const [customSuccess, setCustomSuccess] = useState(Boolean(customValue));
  const toggle = (option: string) => {
    setGoals({
      success: draft.goals.success.includes(option)
        ? draft.goals.success.filter((item) => item !== option)
        : [...draft.goals.success, option],
    });
  };

  return (
    <StepFrame
      onContinue={onContinue}
      saving={saving}
      disabled={draft.goals.success.length === 0}
    >
      <p className="text-muted-foreground mb-3 text-xs leading-5">
        Choose every outcome that would make Chief feel worthwhile.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {successOptions.map((option) => (
          <Chip
            key={option}
            selected={draft.goals.success.includes(option)}
            onClick={() => toggle(option)}
          >
            {option}
          </Chip>
        ))}
        <Chip
          selected={customSuccess}
          onClick={() => {
            const next = !customSuccess;
            setCustomSuccess(next);
            if (!next && customValue) {
              setGoals({
                success: draft.goals.success.filter(
                  (item) => item !== customValue,
                ),
              });
            }
          }}
        >
          Something else
        </Chip>
      </div>
      <Input
        className={cn("mt-4", !customSuccess && "hidden")}
        autoFocus={customSuccess}
        value={customValue}
        onChange={(event) => {
          const nextValue = event.target.value;
          const presetValues = draft.goals.success.filter((item) =>
            successOptions.includes(item),
          );
          setGoals({
            success: nextValue ? [...presetValues, nextValue] : presetValues,
          });
        }}
        placeholder="Describe the outcome"
      />
    </StepFrame>
  );
}

function TimeControl({
  draft,
  setGoals,
  onContinue,
  saving,
}: {
  draft: OnboardingDraft;
  setGoals: (patch: Partial<OnboardingDraft["goals"]>) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  const index = Math.max(0, timeOptions.indexOf(draft.goals.timeBudget));
  return (
    <StepFrame onContinue={onContinue} saving={saving}>
      <div className="px-1 py-3">
        <div className="text-center text-sm font-medium">
          {draft.goals.timeBudget}
        </div>
        <input
          type="range"
          aria-label="Time available each week"
          min={0}
          max={timeOptions.length - 1}
          value={index}
          onChange={(event) =>
            setGoals({ timeBudget: timeOptions[Number(event.target.value)] })
          }
          className="[&::-moz-range-track]:bg-border [&::-webkit-slider-runnable-track]:bg-border mt-3 h-9 w-full cursor-pointer appearance-none bg-transparent accent-white focus-visible:outline-none [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-thumb]:-mt-2 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
        />
        <div className="text-muted-foreground mt-4 flex justify-between text-xs">
          <span>Less</span>
          <span>More</span>
        </div>
      </div>
    </StepFrame>
  );
}

function AutomationControl({
  draft,
  setAutomation,
  onContinue,
  saving,
}: {
  draft: OnboardingDraft;
  setAutomation: (patch: Partial<OnboardingDraft["automation"]>) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  const enabledCount = draft.automation.plan.filter(
    (item) => item.enabled,
  ).length;
  const updateItem = (
    playbookId: string,
    patch: Partial<OnboardingAutomationItem>,
  ) => {
    setAutomation({
      plan: draft.automation.plan.map((item) =>
        item.playbookId === playbookId ? { ...item, ...patch } : item,
      ),
    });
  };
  const agentLabels: Record<string, string> = {
    analyst: "Analyst",
    content: "Content Writer",
    prospector: "Prospector",
  };
  const modes: {
    mode: AutomationMode;
    label: string;
    detail: string;
  }[] = [
    {
      mode: "automatic",
      label: "Activate selected",
      detail: "Activate at final completion.",
    },
    {
      mode: "review",
      label: "Save for later",
      detail: "Add to Schedule without activating.",
    },
    {
      mode: "manual",
      label: "Not now",
      detail: "Leave recurring work empty.",
    },
  ];

  return (
    <StepFrame
      onContinue={onContinue}
      saving={saving}
      disabled={draft.automation.mode !== "manual" && enabledCount === 0}
      continueLabel={
        draft.automation.mode === "automatic"
          ? "Activate selected"
          : draft.automation.mode === "review"
            ? "Save selected"
            : "Skip for now"
      }
    >
      <div className="grid gap-2 sm:grid-cols-3">
        {modes.map((option) => (
          <button
            key={option.mode}
            type="button"
            onClick={() => setAutomation({ mode: option.mode })}
            className={cn(
              "bg-background hover:border-foreground rounded-xl border p-3 text-left transition-colors",
              draft.automation.mode === option.mode &&
                "border-foreground bg-accent",
            )}
          >
            <span className="block text-sm font-medium">{option.label}</span>
            <span className="text-muted-foreground mt-1 block text-xs leading-5">
              {option.detail}
            </span>
          </button>
        ))}
      </div>

      {draft.automation.mode !== "manual" ? (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Recommended recurring work</p>
              <p className="text-muted-foreground mt-1 text-xs leading-5">
                A practical starting point for a new workspace.
              </p>
            </div>
            <span className="text-muted-foreground text-xs">
              {draft.automation.timezone.split("/").at(-1)?.replace(/_/g, " ")}{" "}
              time
            </span>
          </div>
          <div className="bg-background max-h-[360px] divide-y overflow-y-auto rounded-xl border">
            {draft.automation.plan.map((item) => {
              const playbook = getPlaybook(item.playbookId);
              return (
                <div
                  key={item.playbookId}
                  className={cn(
                    "grid gap-4 px-4 py-4 transition-opacity sm:grid-cols-[minmax(0,1fr)_304px] sm:items-center",
                    !item.enabled && "opacity-50",
                  )}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <button
                      type="button"
                      aria-pressed={item.enabled}
                      aria-label={`${item.enabled ? "Remove" : "Add"} ${item.title}`}
                      onClick={() =>
                        updateItem(item.playbookId, { enabled: !item.enabled })
                      }
                      className={cn(
                        "border-border/80 bg-background hover:border-foreground/60 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[6px] border text-transparent shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_4%,transparent)] transition-[border-color,background-color,color,box-shadow] focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:outline-none",
                        item.enabled &&
                          "border-foreground bg-foreground text-background shadow-none",
                      )}
                    >
                      {item.enabled ? <Check size={12} /> : null}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="min-w-0 truncate text-sm font-medium">
                          {item.title}
                        </p>
                        <IntegrationAvatarStack
                          integrations={playbook?.integrations}
                          max={4}
                        />
                      </div>
                      <p className="text-muted-foreground mt-1 text-[11px]">
                        {agentLabels[item.agentId] ?? item.agentId}
                      </p>
                      <p className="text-muted-foreground mt-1.5 text-xs leading-5">
                        {item.purpose}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 pl-8 sm:w-[304px] sm:justify-end sm:pl-0">
                    <Select
                      value={item.frequency}
                      onValueChange={(value) =>
                        updateItem(item.playbookId, {
                          frequency: value as AutomationFrequency,
                        })
                      }
                    >
                      <SelectTrigger
                        aria-label={`${item.title} frequency`}
                        disabled={!item.enabled}
                        className="bg-background h-8 w-24 text-xs"
                      >
                        <span className="whitespace-nowrap">
                          {item.frequency === "daily" ? "Daily" : "Weekly"}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                      </SelectContent>
                    </Select>
                    {item.frequency === "weekly" ? (
                      <Select
                        value={String(item.day)}
                        onValueChange={(value) =>
                          updateItem(item.playbookId, {
                            day: Number(value),
                          })
                        }
                      >
                        <SelectTrigger
                          aria-label={`${item.title} day`}
                          disabled={!item.enabled}
                          className="bg-background h-8 w-20 text-xs"
                        >
                          <span className="whitespace-nowrap">
                            {weekDays[item.day]?.slice(0, 3)}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          {weekDays.map((day, index) => (
                            <SelectItem key={day} value={String(index)}>
                              {day}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                    <Select
                      value={item.time}
                      onValueChange={(time) =>
                        updateItem(item.playbookId, { time })
                      }
                    >
                      <SelectTrigger
                        aria-label={`${item.title} time`}
                        disabled={!item.enabled}
                        className="bg-background h-8 w-28 text-xs"
                      >
                        <span className="whitespace-nowrap">
                          {scheduleTimeOptions.find(
                            (option) => option.value === item.time,
                          )?.label ?? item.time}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        {scheduleTimeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-muted-foreground mt-3 text-xs leading-5">
            This only activates the schedules above. Publishing, outreach and
            spend still need approval.
          </p>
        </div>
      ) : null}
    </StepFrame>
  );
}

function MonitoringControl({
  draft,
  setMonitoring,
  onContinue,
  saving,
}: {
  draft: OnboardingDraft;
  setMonitoring: (patch: Partial<OnboardingDraft["monitoring"]>) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  const toggle = (label: string) => {
    const selected = draft.monitoring.channels.includes(label);
    setMonitoring({
      channels: selected
        ? draft.monitoring.channels.filter((item) => item !== label)
        : [...draft.monitoring.channels, label],
    });
  };

  return (
    <StepFrame onContinue={onContinue} saving={saving}>
      <div className="flex flex-wrap gap-2">
        {monitoringOptions.map(({ key, label, platform, Icon }) => (
          <Chip
            key={key}
            selected={draft.monitoring.channels.includes(label)}
            onClick={() => toggle(label)}
          >
            {platform ? (
              <SocialIcon label={label} platform={platform} />
            ) : (
              <Icon size={15} />
            )}
            {label}
          </Chip>
        ))}
      </div>
      <div className="bg-background mt-5 rounded-xl border p-4">
        <div className="max-w-xl">
          <p className="text-sm font-medium">What should agents look for?</p>
          <p className="text-muted-foreground mt-1.5 text-xs leading-5">
            Add the problems customers describe and competitors worth watching.
            This gives your agents a useful place to start.
          </p>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-[1.15fr_0.85fr]">
          <label htmlFor="monitoring-signals" className="block">
            <span className="text-foreground mb-2 block text-xs font-medium">
              Signals to watch
            </span>
            <Input
              id="monitoring-signals"
              value={draft.monitoring.keywords}
              onChange={(event) =>
                setMonitoring({ keywords: event.target.value })
              }
              placeholder="e.g. slow video editing, content backlog, Descript"
            />
          </label>
          <label htmlFor="monitoring-places" className="block">
            <span className="text-foreground mb-2 block text-xs font-medium">
              Places to focus{" "}
              <span className="text-muted-foreground">(optional)</span>
            </span>
            <Input
              id="monitoring-places"
              value={draft.monitoring.details}
              onChange={(event) =>
                setMonitoring({ details: event.target.value })
              }
              placeholder='e.g. r/VideoEditing, "best video editor"'
            />
          </label>
        </div>
      </div>
    </StepFrame>
  );
}

function IntegrationPickerControl({
  selected,
  setSelected,
  fallbackIntegrations,
  defaultSearchQuery,
  searchPlaceholder,
  emptySelectionLabel,
  skipLabel,
  onEmptySelection,
  onSkip,
  onContinue,
  saving,
}: {
  selected: IntegrationSearchResult[];
  setSelected: (integrations: IntegrationSearchResult[]) => void;
  fallbackIntegrations: IntegrationSearchResult[];
  defaultSearchQuery: string;
  searchPlaceholder: string;
  emptySelectionLabel: string;
  skipLabel: string;
  onEmptySelection: () => void;
  onSkip: () => void;
  onContinue: () => void;
  saving: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IntegrationSearchResult[]>(
    () => cachedIntegrationSearch(defaultSearchQuery) ?? fallbackIntegrations,
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(
        cachedIntegrationSearch(defaultSearchQuery) ?? fallbackIntegrations,
      );
      setLoading(false);
      return;
    }
    setLoading(true);
    const timeout = window.setTimeout(() => {
      void searchIntegrations(trimmed)
        .then((items) => {
          if (cancelled) return;
          setResults(items.length ? items : fallbackIntegrations);
        })
        .catch(() => {
          if (!cancelled) setResults(fallbackIntegrations);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [defaultSearchQuery, fallbackIntegrations, query]);

  const options = useMemo(() => {
    const seen = new Set<string>();
    return [...selected, ...fallbackIntegrations, ...results].filter(
      (integration) => {
        if (seen.has(integration.domain)) return false;
        seen.add(integration.domain);
        return true;
      },
    );
  }, [fallbackIntegrations, results, selected]);

  const toggle = (integration: IntegrationSearchResult) => {
    const exists = selected.some((item) => item.domain === integration.domain);
    setSelected(
      exists
        ? selected.filter((item) => item.domain !== integration.domain)
        : [...selected, integration],
    );
  };

  return (
    <StepFrame
      onContinue={onContinue}
      saving={saving}
      disabled={!selected.length}
      continueLabel="Continue"
      actionsAlign="right"
      actionsLeft={
        <>
          <Button type="button" variant="ghost" onClick={onSkip}>
            {skipLabel}
          </Button>
          {selected.length === 0 ? (
            <Button type="button" onClick={onEmptySelection}>
              {emptySelectionLabel}
            </Button>
          ) : null}
        </>
      }
    >
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={searchPlaceholder}
      />
      <div className="text-muted-foreground mt-3 flex items-center justify-between text-xs">
        <span>Powered by integrations.sh</span>
        <span>{loading ? "Searching..." : `${options.length} options`}</span>
      </div>
      <div className="mt-4 grid h-[360px] auto-rows-[100px] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
        {options.map((integration) => (
          <IntegrationChoiceCard
            key={integration.domain}
            integration={integration}
            selected={selected.some(
              (item) => item.domain === integration.domain,
            )}
            onClick={() => toggle(integration)}
          />
        ))}
      </div>
    </StepFrame>
  );
}

function AdsBudgetControl({
  budget,
  setBudget,
  onContinue,
  saving,
}: {
  budget: string;
  setBudget: (budget: string) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  const index = Math.max(0, adsBudgetOptions.indexOf(budget));
  return (
    <StepFrame onContinue={onContinue} saving={saving}>
      <p className="text-muted-foreground max-w-xl text-sm leading-6">
        You don't have to run ads yourself. Your agents can plan them, launch
        them and keep an eye on the spend, and nothing goes live without your
        OK. Roughly what could you put toward ads each month?
      </p>
      <div className="mt-2 px-1 py-3">
        <div className="text-center text-sm font-medium">{budget}</div>
        <input
          type="range"
          aria-label="Monthly advertising budget"
          min={0}
          max={adsBudgetOptions.length - 1}
          value={index}
          onChange={(event) =>
            setBudget(adsBudgetOptions[Number(event.target.value)]!)
          }
          className="[&::-moz-range-track]:bg-border [&::-webkit-slider-runnable-track]:bg-border mt-3 h-9 w-full cursor-pointer appearance-none bg-transparent accent-white focus-visible:outline-none [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-thumb]:-mt-2 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
        />
        <div className="text-muted-foreground mt-4 flex justify-between text-xs">
          <span>Not yet</span>
          <span>More</span>
        </div>
      </div>
    </StepFrame>
  );
}

function AeoControl({
  selected,
  setSelected,
  onContinue,
  saving,
}: {
  selected: boolean;
  setSelected: (trackAiReferrals: boolean) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  return (
    <StepFrame onContinue={onContinue} saving={saving}>
      <p className="text-muted-foreground text-sm leading-6">
        AI assistants increasingly recommend products before buyers visit your
        site. Chief watches analytics for AI referrals and reports what is
        sending traffic.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Chip selected={selected} onClick={() => setSelected(true)}>
          Track AI referrals
        </Chip>
        <Chip selected={!selected} onClick={() => setSelected(false)}>
          Not now
        </Chip>
      </div>
      {selected ? (
        <p className="text-muted-foreground mt-4 text-xs leading-5">
          Chief will report attributable AI referrals from the analytics source
          you connect, while keeping unknown direct traffic separate.
        </p>
      ) : null}
    </StepFrame>
  );
}

function CompletionControl({
  onContinue,
  ready,
  saving,
}: {
  onContinue: () => void;
  ready: boolean;
  saving: boolean;
}) {
  return (
    <div className="bg-card flex min-h-[480px] w-full items-center justify-center rounded-xl border px-6 py-14">
      <div className="flex max-w-sm flex-col items-center text-center">
        <SuccessCheck className="mb-8" />
        <div className="success-copy flex flex-col items-center">
          <h2 className="text-4xl leading-none font-normal tracking-[-0.04em]">
            You're in.
          </h2>
          <p className="text-muted-foreground mt-4 text-sm leading-6">
            {ready
              ? "Your workspace is ready. Chief will meet you in mission control and bring Setup in when needed."
              : "Chief is preparing your workspace now."}
          </p>
          <Button
            type="button"
            className="mt-9"
            onClick={onContinue}
            disabled={saving || !ready}
          >
            {saving
              ? "Entering..."
              : ready
                ? "Enter workspace"
                : "Preparing workspace..."}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const { cloudOrganizationId, user, signOut } = useAuth();
  const { status: runtimeStatus } = useRuntime();
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const agentPreferences = useAgentPreferences(cloudOrganizationId);
  const deploymentState = useAgentDeployments(cloudOrganizationId);
  const { isAuthenticated: convexReady } = useConvexAuth();
  const upsertSocial = useMutation(api.socialAccounts.upsert);
  const removeSocial = useMutation(api.socialAccounts.remove);
  const socialAccounts = useQuery(
    api.socialAccounts.list,
    convexReady && cloudOrganizationId ? {} : "skip",
  );
  const [org, setOrg] = useState<AuthOrganization | null>(null);
  const [draft, setDraft] = useState<OnboardingDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingStep, setEditingStep] = useState<StepKey | null>(null);
  const currentQuestionRef = useRef<HTMLDivElement | null>(null);
  const completionStartedRef = useRef(false);
  const gatewayInputs = useStoredInputs(
    draft?.workspaceMode === "cloud" && draft.deploymentProvider === "convex"
      ? [AI_GATEWAY_API_KEY]
      : null,
  );
  // Deep link: /onboarding?step=analytics reopens setup at that step (the
  // dashboard's finish-setting-up card uses this to resume skipped items).
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    let cancelled = false;
    void listAuthOrganizations().then((orgs) => {
      if (cancelled) return;
      const active =
        orgs.find((candidate) => candidate.id === cloudOrganizationId) ??
        orgs[0] ??
        null;
      setOrg(active);
      const loaded = active
        ? loadDraft(active, user?.name)
        : loadPendingDraft();
      const requestedStep = searchParams.get("step") as StepKey | null;
      if (requestedStep && steps.includes(requestedStep)) {
        setDraft({ ...loaded, step: requestedStep });
        setSearchParams({}, { replace: true });
      } else {
        setDraft(loaded);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [cloudOrganizationId, searchParams, setSearchParams, user?.name]);

  useEffect(() => {
    void Promise.allSettled([
      searchIntegrations("analytics"),
      searchIntegrations("ads"),
    ]);
  }, []);

  useEffect(() => {
    if (!draft) return;
    localStorage.setItem(
      org ? storageKey(org.id) : pendingStorageKey(),
      JSON.stringify(draft),
    );
  }, [draft, org]);

  useEffect(() => {
    if (!socialAccounts) return;
    setDraft((current) => {
      if (!current) return current;
      const nextSocials = { ...current.socials };
      for (const account of socialAccounts) {
        nextSocials[account.platform] = account.handle;
      }
      return { ...current, socials: nextSocials };
    });
  }, [socialAccounts]);

  const latestStep = draft?.step ?? "mode";
  const step = editingStep ?? latestStep;
  const currentIndex = steps.indexOf(latestStep);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      currentQuestionRef.current?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  const setField = useCallback((patch: Partial<OnboardingDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const setSocial = useCallback((platform: SocialPlatform, handle: string) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            socials: { ...current.socials, [platform]: handle },
          }
        : current,
    );
  }, []);

  const setGoals = useCallback((patch: Partial<OnboardingDraft["goals"]>) => {
    setDraft((current) =>
      current ? { ...current, goals: { ...current.goals, ...patch } } : current,
    );
  }, []);

  const setBrand = useCallback((patch: Partial<OnboardingDraft["brand"]>) => {
    setDraft((current) =>
      current ? { ...current, brand: { ...current.brand, ...patch } } : current,
    );
  }, []);

  const setMonitoring = useCallback(
    (patch: Partial<OnboardingDraft["monitoring"]>) => {
      setDraft((current) =>
        current
          ? { ...current, monitoring: { ...current.monitoring, ...patch } }
          : current,
      );
    },
    [],
  );

  const setAnalyticsIntegrations = useCallback(
    (integrations: IntegrationSearchResult[]) => {
      setDraft((current) =>
        current
          ? { ...current, analytics: { ...current.analytics, integrations } }
          : current,
      );
    },
    [],
  );

  const setAdsIntegrations = useCallback(
    (integrations: IntegrationSearchResult[]) => {
      setDraft((current) =>
        current
          ? { ...current, ads: { ...current.ads, integrations } }
          : current,
      );
    },
    [],
  );

  const setAdsBudget = useCallback((budget: string) => {
    setDraft((current) =>
      current ? { ...current, ads: { ...current.ads, budget } } : current,
    );
  }, []);

  const setAeo = useCallback((patch: Partial<OnboardingDraft["aeo"]>) => {
    setDraft((current) =>
      current ? { ...current, aeo: { ...current.aeo, ...patch } } : current,
    );
  }, []);

  const setEngineering = useCallback(
    (patch: Partial<OnboardingDraft["engineering"]>) => {
      setDraft((current) =>
        current
          ? {
              ...current,
              engineering: { ...current.engineering, ...patch },
            }
          : current,
      );
    },
    [],
  );

  const setAutomation = useCallback(
    (patch: Partial<OnboardingDraft["automation"]>) => {
      setDraft((current) =>
        current
          ? {
              ...current,
              automation: { ...current.automation, ...patch },
            }
          : current,
      );
    },
    [],
  );

  const clearAnalyticsSelection = useCallback(() => {
    setNotice(null);
    setError(null);
    setDraft((current) =>
      current
        ? {
            ...current,
            analytics: { ...current.analytics, integrations: [] },
            ...(editingStep ? {} : { step: "ads" as const }),
          }
        : current,
    );
    if (editingStep) setEditingStep(null);
  }, [editingStep]);

  const clearAdsSelection = useCallback(() => {
    setNotice(null);
    setError(null);
    setDraft((current) =>
      current
        ? {
            ...current,
            ads: { ...current.ads, integrations: [] },
            ...(editingStep ? {} : { step: "adsBudget" as const }),
          }
        : current,
    );
    if (editingStep) setEditingStep(null);
  }, [editingStep]);

  const goNext = useCallback(() => {
    setNotice(null);
    setError(null);
    setDraft((current) => {
      if (!current) return current;
      const next = nextOnboardingStep(current.step);
      return { ...current, step: next };
    });
  }, []);

  const finishCurrentStep = useCallback(() => {
    if (editingStep) {
      setEditingStep(null);
      return;
    }
    goNext();
  }, [editingStep, goNext]);

  const prepareWorkspace = useCallback(async () => {
    if (!draft || org) return false;
    const created = await createAuthOrganization({
      name: "New workspace",
      slug: slugify("chief-workspace"),
    });
    const metadata = parseOrganizationMetadata(created);
    const onboarding =
      metadata.onboarding && typeof metadata.onboarding === "object"
        ? (metadata.onboarding as Record<string, unknown>)
        : {};
    await updateAuthOrganization(created.id, {
      metadata: {
        ...metadata,
        onboarding: { ...onboarding, provisional: true },
      },
    });
    await setActiveAuthOrganization(created.id);
    const nextDraft = { ...draft, step: "inference" as const };
    localStorage.setItem(storageKey(created.id), JSON.stringify(nextDraft));
    localStorage.removeItem(pendingStorageKey());
    primeLocalIntegrationStatus(created.id, []);
    setOrg({
      ...created,
      metadata: {
        ...metadata,
        onboarding: { ...onboarding, provisional: true },
      },
    });
    setDraft(nextDraft);
    return true;
  }, [draft, org]);

  const persistContext = useCallback(async () => {
    if (!draft) return false;
    const logo = (await resolveFaviconUrl(draft.websiteUrl)) ?? undefined;
    if (!org) {
      const name = draft.companyName.trim();
      if (!name) return false;
      const created = await createAuthOrganization({
        name,
        slug: slugify(name),
        ...(logo ? { logo } : {}),
      });
      const metadata = parseOrganizationMetadata(created);
      const nextDraft = { ...draft, step: "inference" as StepKey };
      await updateAuthOrganization(created.id, {
        metadata: { ...metadata, websiteUrl: draft.websiteUrl.trim() },
      });
      await setActiveAuthOrganization(created.id);
      localStorage.setItem(storageKey(created.id), JSON.stringify(nextDraft));
      localStorage.removeItem(pendingStorageKey());
      window.location.assign("/onboarding");
      return true;
    }
    const metadata = parseOrganizationMetadata(org);
    const onboarding =
      metadata.onboarding && typeof metadata.onboarding === "object"
        ? { ...(metadata.onboarding as Record<string, unknown>) }
        : {};
    delete onboarding.provisional;
    await updateAuthOrganization(org.id, {
      name: draft.companyName.trim() || org.name,
      ...(!org.logo && logo ? { logo } : {}),
      metadata: {
        ...metadata,
        websiteUrl: draft.websiteUrl.trim(),
        onboarding,
      },
    });
    setOrg({
      ...org,
      name: draft.companyName.trim() || org.name,
      logo: org.logo ?? logo,
      metadata: {
        ...metadata,
        websiteUrl: draft.websiteUrl.trim(),
        onboarding,
      },
    });
    return false;
  }, [draft, org]);

  const persistSocials = useCallback(async () => {
    if (!draft || !convexReady) return;
    await Promise.all(
      SOCIAL_PLATFORMS.map((def) => {
        const handle = draft.socials[def.platform]?.trim() ?? "";
        return handle
          ? upsertSocial({ platform: def.platform, handle })
          : removeSocial({ platform: def.platform });
      }),
    );
  }, [convexReady, draft, removeSocial, upsertSocial]);

  const persistProvider = useCallback(() => {
    if (!draft) return;
    if (!draft.provider || !org) return;
    setWorkspaceProvider(org.id, draft.provider);
    updatePendingOnboardingDriver(org.id, draft.provider, draft.model || null);
    const existing = agentPreferences.preferences.find(
      (preference) => preference.agentId === "chief",
    );
    agentPreferences.save({
      ...existing,
      agentId: "chief",
      enabled: true,
      driver: draft.provider,
      model: draft.model || undefined,
    });
  }, [agentPreferences, draft, org]);

  const startCloudDeployment = useCallback(() => {
    if (!org || !draft?.deploymentProvider) {
      setError("This workspace must exist before Chief can deploy it.");
      return false;
    }
    if (!deploymentState.ready) {
      setError("Chief is still connecting to the local deployment service.");
      return false;
    }
    return deploymentState.start({
      agentId: "chief",
      target: draft.deploymentProvider,
      projectName:
        `chief-${org.id.replace(/[^a-z0-9]/gi, "").slice(-8)}`.toLowerCase(),
      playbooks: PLAYBOOKS.map((playbook) => ({
        id: playbook.id,
        title: playbook.title,
        summary: playbook.summary,
        instructions: playbookInstructions(playbook),
      })),
      activate: true,
    });
  }, [deploymentState, draft, org]);

  const completeOnboarding = useCallback(async () => {
    if (!org || !draft || completionStartedRef.current) return;
    if (!workspaceData.onboardingBootstrapReady) {
      return;
    }
    if (
      draft.workspaceMode === "cloud" &&
      !deploymentState.deployments.some(
        (deployment) =>
          deployment.workspaceId === org.id &&
          deployment.target === draft.deploymentProvider &&
          deployment.status === "ready",
      )
    ) {
      setError("Finish the selected cloud deployment before continuing.");
      return;
    }
    completionStartedRef.current = true;
    setSaving(true);
    setError(null);
    sessionStorage.setItem(`chief:onboarding:${org.id}`, String(Date.now()));
    try {
      await persistContext();
      await persistSocials();
      persistProvider();
      const metadata = parseOrganizationMetadata(org);
      const persistedOnboarding =
        metadata.onboarding && typeof metadata.onboarding === "object"
          ? { ...(metadata.onboarding as Record<string, unknown>) }
          : {};
      delete persistedOnboarding.provisional;
      const kickoffMetadata = {
        ...metadata,
        websiteUrl: draft.websiteUrl.trim(),
        onboarding: {
          ...persistedOnboarding,
          provider: draft.provider,
          model: draft.model || null,
          deploymentProvider: draft.deploymentProvider,
          providerMode: draft.providerMode,
          workspaceMode: draft.workspaceMode,
          cloudDeploymentUrl:
            deploymentState.deployments.find(
              (deployment) =>
                deployment.workspaceId === org.id &&
                deployment.target === draft.deploymentProvider &&
                deployment.status === "ready",
            )?.url ?? draft.cloudDeploymentUrl.trim(),
          brand: {
            mode: draft.brand.mode,
            notes: draft.brand.notes,
            files: draft.brand.files.map(({ name, type }) => ({ name, type })),
          },
          goals: draft.goals,
          monitoring: draft.monitoring,
          analytics: draft.analytics,
          ads: draft.ads,
          aeo: draft.aeo,
          engineering: draft.engineering,
          automation: draft.automation,
        },
      };
      const jobs = buildOnboardingWorkJobs({
        workspaceId: org.id,
        companyName: draft.companyName,
        websiteUrl: draft.websiteUrl,
        timezone: draft.automation.timezone,
        brand: draft.brand,
        analytics: draft.analytics,
        ads: draft.ads,
        aeo: draft.aeo,
      });
      const schedules = buildOnboardingSchedules(draft.automation, org.id);
      const completedMetadata = {
        ...kickoffMetadata,
        onboarding: {
          ...kickoffMetadata.onboarding,
          completedAt: new Date().toISOString(),
        },
      };
      await updateAuthOrganization(org.id, {
        name: draft.companyName.trim() || org.name,
        metadata: completedMetadata,
      });
      // Workspace access and channel preparation have different durability
      // guarantees. Commit onboarding first, then let the runtime's persisted
      // queue prepare or retry mission control without trapping the user here.
      let onboardingRun: Promise<string> | null = null;
      try {
        onboardingRun = workspaceData.bootstrapOnboardingWork(
          jobs,
          schedules,
          workspaceContextFromOrganization({
            ...org,
            name: draft.companyName.trim() || org.name,
            metadata: completedMetadata,
          }),
          draft.provider ?? undefined,
          draft.model || null,
        );
      } catch (onboardingError) {
        console.warn(
          "[Onboarding] Mission control onboarding could not be queued yet",
          onboardingError,
        );
      }
      localStorage.removeItem(storageKey(org.id));
      window.dispatchEvent(new Event("chief:onboarding-complete"));
      navigate("/", { replace: true });
      void onboardingRun?.catch((onboardingError: unknown) => {
        console.warn(
          "[Onboarding] Mission control onboarding will retry in the background",
          onboardingError,
        );
      });
    } catch (err) {
      sessionStorage.removeItem(`chief:onboarding:${org.id}`);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      completionStartedRef.current = false;
      setSaving(false);
    }
  }, [
    draft,
    org,
    persistContext,
    persistProvider,
    persistSocials,
    navigate,
    workspaceData,
    deploymentState.deployments,
  ]);

  const advance = useCallback(async () => {
    if (!draft || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (step === "mode") {
        if (await prepareWorkspace()) return;
        finishCurrentStep();
        return;
      }
      if (step === "context" && (await persistContext())) return;
      if (step === "socials") await persistSocials();
      if (step === "inference") {
        if (draft.workspaceMode === "cloud") {
          if (!startCloudDeployment()) return;
        } else {
          persistProvider();
        }
      }
      if (step === "finish") {
        await completeOnboarding();
        return;
      }
      if (!editingStep && step === "engineering") {
        setDraft((current) =>
          current
            ? {
                ...current,
                step: current.engineering.enabled ? "engineeringTools" : "aeo",
              }
            : current,
        );
        return;
      }
      finishCurrentStep();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [
    completeOnboarding,
    draft,
    editingStep,
    finishCurrentStep,
    persistContext,
    prepareWorkspace,
    persistProvider,
    persistSocials,
    saving,
    startCloudDeployment,
    step,
  ]);

  const changeDeploymentProvider = useCallback(() => {
    setError(null);
    setNotice(null);
    setDraft((current) =>
      current ? { ...current, step: "inference" } : current,
    );
  }, []);

  const useLocalWorkspace = useCallback(() => {
    setError(null);
    setNotice(null);
    if (org) clearWorkspaceProvider(org.id);
    setDraft((current) =>
      current ? { ...current, ...LOCAL_ONBOARDING_FALLBACK } : current,
    );
  }, [org]);

  const currentControl = useMemo(() => {
    if (!draft) return null;
    if (step === "mode") {
      return (
        <ModeControl
          draft={draft}
          setField={setField}
          onContinue={advance}
          saving={saving}
        />
      );
    }
    if (step === "inference") {
      return (
        <ProviderControl
          draft={draft}
          setField={setField}
          gatewayConfigured={
            draft.deploymentProvider === "convex"
              ? gatewayInputs.present?.has(AI_GATEWAY_API_KEY) === true
                ? true
                : gatewayInputs.present === null
                  ? null
                  : false
              : true
          }
          deploymentReady={deploymentState.ready}
          saveGatewayKey={(value) =>
            gatewayInputs.store(AI_GATEWAY_INPUT_REQUEST, { apiKey: value })
          }
          onChangeLocation={() =>
            setDraft((current) =>
              current ? { ...current, step: "mode" } : current,
            )
          }
          onContinue={advance}
          saving={saving}
        />
      );
    }
    if (step === "health") {
      const deployment = deploymentState.deployments.find(
        (candidate) =>
          candidate.workspaceId === org?.id &&
          candidate.target === draft.deploymentProvider &&
          candidate.status !== "canceled",
      );
      return (
        <HealthControl
          draft={draft}
          runtimeStatus={runtimeStatus}
          convexReady={convexReady}
          deployment={deployment}
          deploymentProvider={draft.deploymentProvider}
          onRetryDeployment={startCloudDeployment}
          onCancelDeployment={() => {
            if (deployment) deploymentState.cancel(deployment.id);
          }}
          onChangeProvider={changeDeploymentProvider}
          onUseLocal={useLocalWorkspace}
          onModelChange={(model) => setField({ model })}
          onBack={() =>
            setDraft((current) =>
              current ? { ...current, step: "inference" } : current,
            )
          }
          onContinue={advance}
          saving={saving}
        />
      );
    }
    if (step === "context") {
      return (
        <ContextControl
          draft={draft}
          setField={setField}
          onContinue={advance}
          saving={saving}
        />
      );
    }
    if (step === "brand") {
      return (
        <BrandControl
          draft={draft}
          setBrand={setBrand}
          onContinue={advance}
          saving={saving}
        />
      );
    }
    if (step === "socials") {
      return (
        <SocialsControl
          draft={draft}
          setSocial={setSocial}
          onContinue={advance}
          saving={saving}
          ready={convexReady && socialAccounts !== undefined}
        />
      );
    }
    if (step === "selling") {
      return (
        <SellingControl
          draft={draft}
          setGoals={setGoals}
          onContinue={advance}
          saving={saving}
        />
      );
    }
    if (step === "audience") {
      return (
        <AudienceControl
          draft={draft}
          setGoals={setGoals}
          onContinue={advance}
          saving={saving}
        />
      );
    }
    if (step === "success") {
      return (
        <SuccessControl
          draft={draft}
          setGoals={setGoals}
          onContinue={advance}
          saving={saving}
        />
      );
    }
    if (step === "time") {
      return (
        <TimeControl
          draft={draft}
          setGoals={setGoals}
          onContinue={advance}
          saving={saving}
        />
      );
    }
    if (step === "monitoring") {
      return (
        <MonitoringControl
          draft={draft}
          setMonitoring={setMonitoring}
          onContinue={advance}
          saving={saving}
        />
      );
    }
    if (step === "analytics") {
      return (
        <IntegrationPickerControl
          selected={draft.analytics.integrations}
          setSelected={setAnalyticsIntegrations}
          fallbackIntegrations={fallbackAnalyticsIntegrations}
          defaultSearchQuery="analytics"
          searchPlaceholder="Search analytics tools"
          emptySelectionLabel={"I don't use analytics"}
          skipLabel="Skip for now"
          onEmptySelection={clearAnalyticsSelection}
          onSkip={clearAnalyticsSelection}
          onContinue={advance}
          saving={saving}
        />
      );
    }
    if (step === "ads") {
      return (
        <IntegrationPickerControl
          selected={draft.ads.integrations}
          setSelected={setAdsIntegrations}
          fallbackIntegrations={fallbackAdsIntegrations}
          defaultSearchQuery="ads"
          searchPlaceholder="Search ads tools"
          emptySelectionLabel="I don't run ads"
          skipLabel="Skip for now"
          onEmptySelection={clearAdsSelection}
          onSkip={clearAdsSelection}
          onContinue={advance}
          saving={saving}
        />
      );
    }
    if (step === "adsBudget") {
      return (
        <AdsBudgetControl
          budget={draft.ads.budget}
          setBudget={setAdsBudget}
          onContinue={advance}
          saving={saving}
        />
      );
    }
    if (step === "engineering") {
      return (
        <EngineeringAccessControl
          selected={draft.engineering.enabled}
          setSelected={(enabled) =>
            setEngineering({
              enabled,
              ...(enabled ? {} : { integrations: [] }),
            })
          }
          onContinue={advance}
          saving={saving}
        />
      );
    }
    if (step === "engineeringTools") {
      return (
        <EngineeringToolsControl
          selected={draft.engineering.integrations}
          setSelected={(integrations) => setEngineering({ integrations })}
          onContinue={advance}
          saving={saving}
        />
      );
    }
    if (step === "aeo") {
      return (
        <AeoControl
          selected={draft.aeo.trackAiReferrals}
          setSelected={(trackAiReferrals) => setAeo({ trackAiReferrals })}
          onContinue={advance}
          saving={saving}
        />
      );
    }
    if (step === "automation") {
      return (
        <AutomationControl
          draft={draft}
          setAutomation={setAutomation}
          onContinue={advance}
          saving={saving}
        />
      );
    }
    return (
      <CompletionControl
        onContinue={() => void completeOnboarding()}
        ready={workspaceData.onboardingBootstrapReady}
        saving={saving}
      />
    );
  }, [
    advance,
    completeOnboarding,
    changeDeploymentProvider,
    deploymentState,
    gatewayInputs,
    convexReady,
    draft,
    org,
    runtimeStatus,
    saving,
    setField,
    setBrand,
    setGoals,
    setAeo,
    setEngineering,
    setAutomation,
    setAdsIntegrations,
    setAdsBudget,
    setAnalyticsIntegrations,
    clearAdsSelection,
    clearAnalyticsSelection,
    setMonitoring,
    setSocial,
    socialAccounts,
    startCloudDeployment,
    step,
    useLocalWorkspace,
    workspaceData.onboardingBootstrapReady,
  ]);

  if (loading) {
    return (
      <div className="bg-background text-muted-foreground flex min-h-screen items-center justify-center text-sm">
        Loading workspace...
      </div>
    );
  }

  if (!draft) return <Navigate to="/workspaces/new" replace />;

  return (
    <div className="bg-background text-foreground flex h-screen flex-col">
      <UserIndicator user={user} onSignOut={signOut} />
      <header data-tauri-drag-region className="h-[72px] shrink-0" />
      <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-6 pb-6">
        <div className="min-h-0 flex-1 space-y-7 overflow-y-auto pr-1 pb-6">
          {steps
            .slice(0, currentIndex)
            .filter(
              (pastStep) =>
                pastStep !== editingStep &&
                !(
                  pastStep === "engineeringTools" && !draft.engineering.enabled
                ),
            )
            .map((pastStep) => (
              <div key={pastStep} className="space-y-3">
                <AgentBubble text={questionText(pastStep, draft)} />
                <EditableAnswer
                  onEdit={() => {
                    setNotice(null);
                    setError(null);
                    setEditingStep(pastStep);
                  }}
                >
                  <AnswerPreview step={pastStep} draft={draft} />
                </EditableAnswer>
              </div>
            ))}
          <div ref={currentQuestionRef} className="space-y-4">
            {step === "finish" ? null : (
              <AgentBubble
                key={step}
                text={questionText(step, draft)}
                current
              />
            )}
            <div className="w-full max-w-[720px]">
              {editingStep ? (
                <div className="text-muted-foreground mb-2 flex items-center justify-between text-xs">
                  <span>Editing your previous answer</span>
                  <button
                    type="button"
                    onClick={() => setEditingStep(null)}
                    className="hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
              {currentControl}
            </div>
            <div className="min-h-5">
              {notice && step !== "analytics" ? (
                <p className="text-muted-foreground text-xs">{notice}</p>
              ) : null}
              {error ? (
                <p className="text-destructive text-xs break-words">{error}</p>
              ) : null}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
