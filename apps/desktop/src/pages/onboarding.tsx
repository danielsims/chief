import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@marketer/backend/convex/_generated/api";
import type { DriverType } from "@marketer/agent-runtime/types";
import {
  siInstagram,
  siReddit,
  siTiktok,
  siX,
  siYoutube,
  type SimpleIcon,
} from "simple-icons";
import { Button } from "@marketer/ui/components/button";
import { Input } from "@marketer/ui/components/input";
import { PrefixedInput } from "@marketer/ui/components/prefixed-input";
import { SuccessCheck } from "@marketer/ui/components/success-check";
import { cn } from "@marketer/ui/lib/utils";
import { Claude, OpenAI, Vercel } from "@lobehub/icons";
import {
  CheckCircle2,
  Cloud,
  Facebook,
  Globe,
  Instagram,
  Laptop,
  Linkedin,
  MessageCircle,
  Search,
  Server,
  Twitter,
  Youtube,
} from "lucide-react";
import { useAuth } from "../lib/auth/auth-context";
import {
  type AuthOrganization,
  createAuthOrganization,
  listAuthOrganizations,
  parseOrganizationMetadata,
  setActiveAuthOrganization,
  updateAuthOrganization,
} from "../lib/auth/better-auth-client";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "../lib/social-platforms";
import { setWorkspaceProvider } from "../lib/agent-overrides";
import { useRuntime } from "../lib/runtime";
import {
  hasWorkspaceAccess,
  openWorkspaceCheckout,
  type BillingPlan,
} from "../lib/billing";
import { connectGoogleAnalytics } from "../lib/google-analytics";
import { persistSetupResult, type SetupResult } from "../lib/integration-setup";
import { IntegrationConnect } from "../components/integrations/integration-connect";
import { resolveFaviconUrl } from "../components/org-logo";
import { GoogleLogo } from "../components/google-logo";
import {
  integrationLogoUrl,
  searchIntegrations,
  type IntegrationSearchResult,
} from "../lib/integrations";

type StepKey =
  | "mode"
  | "inference"
  | "health"
  | "context"
  | "socials"
  | "selling"
  | "audience"
  | "success"
  | "time"
  | "monitoring"
  | "analytics"
  | "analyticsConnect"
  | "ads"
  | "adsConnect"
  | "adsBudget"
  | "aeo"
  | "pricing"
  | "finish";

interface OnboardingDraft {
  workspaceMode: "local" | "cloud";
  companyName: string;
  websiteUrl: string;
  socials: Partial<Record<SocialPlatform, string>>;
  providerMode: "local" | "deployed";
  /** Null until the user explicitly picks an agent app, never defaulted. */
  provider: DriverType | "vercel" | null;
  cloudDeploymentUrl: string;
  goals: {
    selling: string;
    audience: string;
    success: string;
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
  step: StepKey;
}

const steps: StepKey[] = [
  "mode",
  "inference",
  "health",
  "context",
  "socials",
  "selling",
  "audience",
  "success",
  "time",
  "monitoring",
  "analytics",
  "analyticsConnect",
  "ads",
  "adsConnect",
  "adsBudget",
  "aeo",
  "pricing",
  "finish",
];

const questions: Record<StepKey, string> = {
  mode: "First, where should this workspace run?",
  inference: "Which agent app should Marketer use?",
  health: "Quick check before we teach Marketer about your business.",
  context:
    "I'll set this workspace up around one company, so the agents know exactly who they're working for. What's your company and website?",
  socials:
    "Nice. Now add the public accounts the agents should learn from and write for.",
  selling: "Describe what you're selling in a few short words.",
  audience: "Who is your ideal customer?",
  success: "What would make the next 90 days feel like this is working?",
  time: "How much time can you spend on marketing each week?",
  monitoring: "Where should your agents look for prospects and mentions?",
  analytics: "Which analytics platforms do you use today?",
  analyticsConnect: "Got it. Let me set up those analytics sources for you.",
  ads: "Where do you run paid ads today?",
  adsConnect: "Got it. Let me connect those ads accounts for you.",
  adsBudget: "No ads today. Want your agents to run them for you?",
  aeo: "One more thing. Want to know when ChatGPT, Claude or Perplexity send you customers?",
  pricing: "Choose how this workspace is billed.",
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
          "flex h-6 w-6 items-center justify-center border bg-background text-[10px] text-muted-foreground",
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
        "flex h-6 w-6 items-center justify-center border bg-background text-foreground",
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
  return `marketer-onboarding:${orgId}`;
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
    cloudDeploymentUrl: "",
    goals: {
      selling: "",
      audience: "",
      success: "$5k MRR",
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
  const provider =
    onboarding.provider === "claude" ||
    onboarding.provider === "codex" ||
    onboarding.provider === "vercel"
      ? onboarding.provider
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
    providerMode: "local",
    provider,
    cloudDeploymentUrl:
      typeof onboarding.cloudDeploymentUrl === "string"
        ? onboarding.cloudDeploymentUrl
        : "",
    goals: {
      selling: typeof goals.selling === "string" ? goals.selling : "",
      audience: typeof goals.audience === "string" ? goals.audience : "",
      success: typeof goals.success === "string" ? goals.success : "$5k MRR",
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
    step: typeof onboarding.completedAt === "string" ? "pricing" : "mode",
  };
}

function loadStoredDraft(base: OnboardingDraft, key: string): OnboardingDraft {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return base;
    const parsed = JSON.parse(stored) as Partial<OnboardingDraft>;
    const hasSetupMode =
      parsed.workspaceMode === "local" || parsed.workspaceMode === "cloud";
    const parsedMonitoring = parsed.monitoring as
      Partial<OnboardingDraft["monitoring"]> | undefined;
    const parsedAnalytics = parsed.analytics as
      Partial<OnboardingDraft["analytics"]> | undefined;
    const parsedAds = parsed.ads as Partial<OnboardingDraft["ads"]> | undefined;
    const parsedAeo = parsed.aeo as Partial<OnboardingDraft["aeo"]> | undefined;
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
        parsed.provider === "claude" ||
        parsed.provider === "codex" ||
        parsed.provider === "vercel"
          ? parsed.provider
          : base.provider,
      cloudDeploymentUrl: parsed.cloudDeploymentUrl ?? base.cloudDeploymentUrl,
      goals: { ...base.goals, ...(parsed.goals ?? {}) },
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
      step:
        parsed.step && steps.includes(parsed.step) && hasSetupMode
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

function useTypedQuestion(text: string) {
  const [visible, setVisible] = useState(text);
  const [complete, setComplete] = useState(true);

  useEffect(() => {
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
  }, [text]);

  return { visible, complete };
}

function AgentBubble({ text, current }: { text: string; current?: boolean }) {
  const typed = useTypedQuestion(text);
  return (
    <div className="flex justify-start">
      <div className="max-w-[680px] text-[15px] leading-7 text-foreground">
        {current ? typed.visible : text}
        {current && !typed.complete ? (
          <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-pulse bg-foreground" />
        ) : null}
      </div>
    </div>
  );
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[620px] border bg-muted/40 px-3 py-2 text-sm leading-6 text-foreground">
        {children}
      </div>
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
    <div className="fixed left-4 top-10 z-50 flex items-center gap-2">
      <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden border bg-muted text-[11px] font-medium text-muted-foreground">
        {user.image ? (
          <img src={user.image} alt="" className="h-full w-full object-cover" />
        ) : (
          initial
        )}
      </span>
      <span className="max-w-[180px] truncate text-[13px] text-muted-foreground">
        {label}
      </span>
      <span className="text-[13px] text-muted-foreground/40">·</span>
      <button
        type="button"
        onClick={onSignOut}
        className="cursor-pointer text-[13px] text-muted-foreground transition-colors hover:text-foreground"
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

function isGoogleAnalyticsIntegration(
  integration: IntegrationSearchResult | null | undefined,
) {
  return Boolean(
    integration &&
    (integration.domain === "analytics.googleapis.com" ||
      integration.domain === "analyticsadmin.googleapis.com" ||
      integration.name.toLowerCase().includes("google analytics")),
  );
}

function integrationProviderMatches(
  integration: IntegrationSearchResult | null | undefined,
  provider: string | null | undefined,
) {
  if (!integration || !provider) return false;
  return (
    provider === integration.domain ||
    (integration.domain === "analytics.googleapis.com" &&
      provider === "google-analytics")
  );
}

function selectedIntegrationNames(integrations: IntegrationSearchResult[]) {
  return integrations.length
    ? integrations.map((integration) => integration.name).join(", ")
    : null;
}

function providerIdentity(provider: string) {
  if (provider === "google-analytics") {
    return {
      label: "Google Analytics",
      logoDomain: "analytics.googleapis.com",
    };
  }

  return {
    label: provider,
    logoDomain: provider,
  };
}

function integrationFromProvider(provider: string): IntegrationSearchResult {
  const identity = providerIdentity(provider);
  return {
    domain: identity.logoDomain,
    name: identity.label,
    description: provider,
    kinds: [],
    url: `https://integrations.sh/${identity.logoDomain}/`,
  };
}

function modeLabel(draft: OnboardingDraft) {
  return draft.workspaceMode === "cloud" ? "Cloud workspace" : "This Mac";
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
                className="inline-flex items-center gap-2 border bg-background px-2 py-1"
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
        ? "Cloud deployment"
        : draft.provider === "codex"
          ? "Codex"
          : draft.provider === "claude"
            ? "Claude"
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

  if (step === "success") return <UserBubble>{draft.goals.success}</UserBubble>;
  if (step === "time") return <UserBubble>{draft.goals.timeBudget}</UserBubble>;

  if (step === "monitoring") {
    return (
      <UserBubble>
        <div className="flex flex-wrap gap-2">
          {draft.monitoring.channels.map((channel) => (
            <span key={channel} className="border bg-background px-2 py-1">
              {channel}
            </span>
          ))}
        </div>
        {draft.monitoring.keywords || draft.monitoring.details ? (
          <p className="mt-2 text-muted-foreground">
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

  if (step === "analyticsConnect") {
    if (!draft.analytics.integrations.length) {
      return <UserBubble>Not connected yet</UserBubble>;
    }
    return (
      <UserBubble>
        {selectedIntegrationNames(draft.analytics.integrations)}
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

  if (step === "adsConnect") {
    if (!draft.ads.integrations.length) {
      return <UserBubble>No paid ads</UserBubble>;
    }
    return (
      <UserBubble>
        {selectedIntegrationNames(draft.ads.integrations)}
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

  if (step === "pricing") {
    return (
      <UserBubble>
        {draft.providerMode === "deployed" ? "Annual plan" : "Monthly plan"}
      </UserBubble>
    );
  }

  return null;
}

function Chip({
  selected,
  children,
  onClick,
}: {
  selected: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-h-9 items-center gap-2 border px-3 py-1.5 text-sm transition-colors hover:border-foreground",
        selected
          ? "border-foreground bg-accent text-foreground"
          : "bg-background text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function StepFrame({
  children,
  onContinue,
  disabled,
  saving,
  continueLabel = "Continue",
  actionsLeft,
}: {
  children: React.ReactNode;
  onContinue: () => void;
  disabled?: boolean;
  saving?: boolean;
  continueLabel?: string;
  actionsLeft?: React.ReactNode;
}) {
  return (
    <div className="w-full border bg-card/60 p-5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
      {children}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <div className="flex flex-wrap items-center gap-2">{actionsLeft}</div>
        <Button
          type="button"
          onClick={() => void onContinue()}
          disabled={disabled || saving}
        >
          {saving ? "Saving..." : continueLabel}
        </Button>
      </div>
    </div>
  );
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
        provider: "vercel",
      });
      return;
    }

    setField({
      workspaceMode,
      providerMode: "local",
      // Keep an already-made local choice; clear a cloud one. Never assume.
      provider: draft.provider === "vercel" ? null : draft.provider,
    });
  };

  const cardClass = (selected: boolean) =>
    cn(
      "border bg-background p-4 text-left transition-colors hover:border-foreground",
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
            <span className="flex size-8 shrink-0 items-center justify-center border bg-background">
              <Laptop size={16} />
            </span>
            <span>
              <span className="block text-sm font-medium">This Mac</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
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
            <span className="flex size-8 shrink-0 items-center justify-center border bg-background">
              <Cloud size={16} />
            </span>
            <span>
              <span className="block text-sm font-medium">Cloud workspace</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                Run agents from a dedicated cloud workspace, with isolated
                storage for this company and room to work while your Mac is
                offline.
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
          <span className="text-xs text-muted-foreground">Company</span>
          <Input
            autoFocus
            value={draft.companyName}
            onChange={(event) => setField({ companyName: event.target.value })}
            placeholder="Marketer"
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs text-muted-foreground">Website</span>
          <Input
            value={draft.websiteUrl}
            onChange={(event) => setField({ websiteUrl: event.target.value })}
            placeholder="marketer.com"
          />
        </label>
      </div>
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
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <SocialIcon label={def.label} platform={def.platform} />
              {def.label}
            </span>
            <PrefixedInput
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
  onContinue,
  saving,
}: {
  draft: OnboardingDraft;
  setField: (patch: Partial<OnboardingDraft>) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  const optionClass = (selected: boolean) =>
    cn(
      "flex min-h-[112px] items-start gap-3 border bg-background p-4 text-left transition-colors hover:border-foreground",
      selected && "border-foreground bg-muted",
    );

  if (draft.workspaceMode === "cloud") {
    return (
      <StepFrame onContinue={onContinue} saving={saving}>
        <div className="space-y-4">
          <button
            type="button"
            onClick={() =>
              setField({ providerMode: "deployed", provider: "vercel" })
            }
            className={cn(optionClass(draft.provider === "vercel"), "w-full")}
          >
            <Vercel size={18} className="mt-0.5 shrink-0" />
            <span>
              <span className="block text-sm font-medium">
                Cloud deployment
              </span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                Connect the hosted agent service for this workspace. Each
                company gets its own working area for data and connector
                secrets.
              </span>
            </span>
          </button>

          <label className="block space-y-1.5">
            <span className="text-xs text-muted-foreground">
              Agent endpoint
            </span>
            <Input
              value={draft.cloudDeploymentUrl}
              onChange={(event) =>
                setField({ cloudDeploymentUrl: event.target.value })
              }
              placeholder="https://your-agent-service.vercel.app"
            />
          </label>
          <p className="text-xs leading-5 text-muted-foreground">
            You can leave this blank while setup continues. The workspace will
            remember that agents should run from the cloud.
          </p>
        </div>
      </StepFrame>
    );
  }

  return (
    <StepFrame
      onContinue={onContinue}
      saving={saving}
      disabled={draft.provider !== "claude" && draft.provider !== "codex"}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() =>
            setField({ providerMode: "local", provider: "claude" })
          }
          className={optionClass(
            draft.providerMode === "local" && draft.provider === "claude",
          )}
        >
          <Claude.Color size={18} className="mt-0.5 shrink-0" />
          <span>
            <span className="block text-sm font-medium">Claude</span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              Uses your existing Claude subscription on this Mac. Good for
              strategy, research and writing work.
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setField({ providerMode: "local", provider: "codex" })}
          className={optionClass(
            draft.providerMode === "local" && draft.provider === "codex",
          )}
        >
          <OpenAI size={18} className="mt-0.5 shrink-0" />
          <span>
            <span className="block text-sm font-medium">Codex</span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              Uses your existing Codex setup. Good when the agent needs to work
              in repos, files and local tools.
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
  detail: string;
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
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
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
  onContinue,
  saving,
}: {
  draft: OnboardingDraft;
  runtimeStatus: "connecting" | "connected" | "disconnected";
  convexReady: boolean;
  onContinue: () => void;
  saving: boolean;
}) {
  const providerLabel =
    draft.workspaceMode === "cloud"
      ? "Cloud deployment"
      : draft.provider === "codex"
        ? "Codex on this Mac"
        : draft.provider === "claude"
          ? "Claude on this Mac"
          : "No agent app chosen yet";
  const runtimeReady =
    draft.workspaceMode === "cloud"
      ? Boolean(draft.cloudDeploymentUrl.trim())
      : runtimeStatus === "connected";

  return (
    <StepFrame
      onContinue={onContinue}
      saving={saving}
      continueLabel="Start business setup"
    >
      <div className="divide-y border bg-background px-4">
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
          icon={draft.workspaceMode === "cloud" ? Cloud : Laptop}
          label={modeLabel(draft)}
          detail={
            draft.workspaceMode === "cloud"
              ? draft.cloudDeploymentUrl.trim()
                ? draft.cloudDeploymentUrl.trim()
                : "Cloud workspace selected. Add the agent endpoint when it is ready."
              : runtimeStatus === "connected"
                ? "The local agent service is reachable."
                : "The local agent service is starting or reconnecting."
          }
          ready={runtimeReady}
        />
        <ReadinessRow
          icon={draft.workspaceMode === "cloud" ? Vercel : Server}
          label="Agent app"
          detail={providerLabel}
          ready={
            draft.workspaceMode === "cloud" ||
            draft.provider === "claude" ||
            draft.provider === "codex"
          }
        />
      </div>
      {!runtimeReady ? (
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          You can continue now. Marketer will keep the workspace setup moving
          while the agent connection finishes coming online.
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
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
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
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
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
  const isPreset = successOptions.includes(draft.goals.success);
  const [customSuccess, setCustomSuccess] = useState(
    Boolean(draft.goals.success) && !isPreset,
  );

  return (
    <StepFrame onContinue={onContinue} saving={saving}>
      <div className="grid gap-2 sm:grid-cols-2">
        {successOptions.map((option) => (
          <Chip
            key={option}
            selected={!customSuccess && draft.goals.success === option}
            onClick={() => {
              setCustomSuccess(false);
              setGoals({ success: option });
            }}
          >
            {option}
          </Chip>
        ))}
        <Chip
          selected={customSuccess}
          onClick={() => {
            setCustomSuccess(true);
            if (isPreset) setGoals({ success: "" });
          }}
        >
          Something else
        </Chip>
      </div>
      <Input
        className={cn("mt-4", !customSuccess && "hidden")}
        autoFocus={customSuccess}
        value={draft.goals.success}
        onChange={(event) => setGoals({ success: event.target.value })}
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
          min={0}
          max={timeOptions.length - 1}
          value={index}
          onChange={(event) =>
            setGoals({ timeBudget: timeOptions[Number(event.target.value)] })
          }
          className="mt-6 h-1 w-full cursor-pointer appearance-none bg-border accent-white [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:bg-border [&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-white"
        />
        <div className="mt-4 flex justify-between text-xs text-muted-foreground">
          <span>Less</span>
          <span>More</span>
        </div>
      </div>
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
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Input
          value={draft.monitoring.keywords}
          onChange={(event) => setMonitoring({ keywords: event.target.value })}
          placeholder="Keywords, pain points or competitor names"
        />
        <Input
          value={draft.monitoring.details}
          onChange={(event) => setMonitoring({ details: event.target.value })}
          placeholder="Specific communities or searches"
        />
      </div>
    </StepFrame>
  );
}

function IntegrationLogo({
  integration,
}: {
  integration: IntegrationSearchResult;
}) {
  const [failed, setFailed] = useState(false);
  if (integration.domain.endsWith(".googleapis.com")) {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center border bg-background">
        <GoogleLogo className="h-4 w-4" />
      </span>
    );
  }

  if (integration.domain === "none" || failed) {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center border bg-background text-[10px] text-muted-foreground">
        {integration.name.slice(0, 1)}
      </span>
    );
  }

  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center border bg-background">
      <img
        src={integrationLogoUrl(integration.domain)}
        alt=""
        className="h-4 w-4"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

function IntegrationCard({
  integration,
  selected,
  onClick,
}: {
  integration: IntegrationSearchResult;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-[100px] items-start gap-3 border bg-background p-4 text-left transition-colors hover:border-foreground",
        selected && "border-foreground bg-muted",
      )}
    >
      <IntegrationLogo integration={integration} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">
          {integration.name}
        </span>
        <span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted-foreground">
          {integration.description || integration.domain}
        </span>
        {integration.kinds.length ? (
          <span className="mt-2 flex flex-wrap gap-1">
            {integration.kinds.slice(0, 3).map((kind) => (
              <span
                key={kind}
                className="border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground"
              >
                {kind}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </button>
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
  const [results, setResults] =
    useState<IntegrationSearchResult[]>(fallbackIntegrations);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const trimmed = query.trim() || defaultSearchQuery;
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
      actionsLeft={
        <>
          <Button type="button" variant="ghost" onClick={onEmptySelection}>
            {emptySelectionLabel}
          </Button>
          <Button type="button" variant="ghost" onClick={onSkip}>
            {skipLabel}
          </Button>
        </>
      }
    >
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={searchPlaceholder}
      />
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>Powered by integrations.sh</span>
        <span>{loading ? "Searching..." : `${options.length} options`}</span>
      </div>
      <div className="mt-4 grid max-h-[360px] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
        {options.map((integration) => (
          <IntegrationCard
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

type ConnectedChannel = {
  provider: string;
  displayName: string;
  category?: string;
};

function ConnectedIntegrationRow({ channel }: { channel: ConnectedChannel }) {
  const providerIntegration = integrationFromProvider(channel.provider);

  return (
    <div className="flex items-center gap-3 py-2.5">
      <IntegrationLogo integration={providerIntegration} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">
          {providerIntegration.name}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {channel.displayName}
        </span>
      </span>
      <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <CheckCircle2 size={15} className="text-emerald-500" />
        Connected
      </span>
    </div>
  );
}

function QueuedIntegrationRow({
  integration,
  onRemove,
}: {
  integration: IntegrationSearchResult;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border bg-background p-3 opacity-60">
      <IntegrationLogo integration={integration} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">
          {integration.name}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          Up next
        </span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-auto shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        Remove
      </button>
    </div>
  );
}

function IntegrationConnectQueueControl({
  category,
  integrations,
  workspaceMode,
  provider,
  channels,
  onAddAnother,
  configStatus,
  connecting,
  notice,
  onConnect,
  onRemove,
  connectedForIntegration,
  onSetupResult,
  onContinue,
  saving,
}: {
  category: "analytics" | "ads";
  integrations: IntegrationSearchResult[];
  workspaceMode: OnboardingDraft["workspaceMode"];
  provider: DriverType | null;
  channels: ConnectedChannel[] | undefined;
  onAddAnother: () => void;
  onRemove: (integration: IntegrationSearchResult) => void;
  connectedForIntegration: (integration: IntegrationSearchResult) => boolean;
  configStatus:
    | {
        configured: boolean;
        source: "environment" | "none";
        hasClientId: boolean;
        hasClientSecret: boolean;
        redirectUri?: string | null;
        missing: string[];
      }
    | undefined;
  connecting: boolean;
  notice: string | null;
  onConnect: () => void;
  onSetupResult: (result: SetupResult) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  const localAgentSetup = workspaceMode === "local" && provider !== null;
  const firstOpenIntegration =
    integrations.find((integration) => !connectedForIntegration(integration)) ??
    null;
  const connectedRows = integrations.flatMap((integration) =>
    (channels ?? [])
      .filter((channel) =>
        integrationProviderMatches(integration, channel.provider),
      )
      .map((channel) => ({ integration, channel })),
  );
  const queuedIntegrations = firstOpenIntegration
    ? integrations.filter(
        (integration) =>
          integration.domain !== firstOpenIntegration.domain &&
          !connectedForIntegration(integration),
      )
    : [];
  const allConnected = integrations.every((integration) =>
    connectedForIntegration(integration),
  );
  const activeIsGoogleAnalytics =
    category === "analytics" &&
    isGoogleAnalyticsIntegration(firstOpenIntegration);
  const cloudGoogleAnalyticsSetup =
    workspaceMode !== "local" && activeIsGoogleAnalytics;
  const oauthStatusText = allConnected
    ? "Google Analytics is connected."
    : configStatus?.configured
      ? `OAuth is ready from ${configStatus.source}.`
      : configStatus === undefined
        ? "Checking Google OAuth setup..."
        : "Google Analytics is saved as your analytics source. The cloud workspace needs Google OAuth enabled before you can connect it.";
  const canConnectGoogleAnalytics = Boolean(configStatus?.configured);
  const mustFinishConnections = localAgentSetup;

  return (
    <StepFrame
      onContinue={onContinue}
      saving={saving}
      disabled={
        mustFinishConnections && integrations.length > 0 && !allConnected
      }
      continueLabel={
        !firstOpenIntegration || localAgentSetup || !cloudGoogleAnalyticsSetup
          ? "Continue"
          : canConnectGoogleAnalytics
            ? "Continue without connecting"
            : "Save source and continue"
      }
    >
      <div className="space-y-3">
        {connectedRows.length ? (
          <div className="divide-y border bg-background px-4">
            {connectedRows.map(({ integration, channel }) => (
              <ConnectedIntegrationRow
                key={`${integration.domain}:${channel.provider}:${channel.displayName}`}
                channel={channel}
              />
            ))}
          </div>
        ) : null}

        {firstOpenIntegration ? (
          <div className="space-y-3">
            <div className="flex items-start gap-3 border bg-background p-4">
              <IntegrationLogo integration={firstOpenIntegration} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {firstOpenIntegration.name}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {firstOpenIntegration.description}
                </p>
                {firstOpenIntegration.url ? (
                  <a
                    className="mt-2 inline-block text-xs text-muted-foreground hover:text-foreground"
                    href={firstOpenIntegration.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View integration facts
                  </a>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => onRemove(firstOpenIntegration)}
                className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Remove
              </button>
            </div>

            {localAgentSetup && provider ? (
              <IntegrationConnect
                integration={firstOpenIntegration}
                driver={provider}
                connected={false}
                onResult={onSetupResult}
              />
            ) : cloudGoogleAnalyticsSetup ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <p className="text-xs leading-5 text-muted-foreground">
                  {oauthStatusText}
                </p>
                {canConnectGoogleAnalytics ? (
                  <Button
                    type="button"
                    onClick={onConnect}
                    disabled={connecting}
                  >
                    {connecting ? "Opening..." : "Connect"}
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="border-t pt-4 text-xs leading-5 text-muted-foreground">
                Saved as this workspace&apos;s {category} source.
              </p>
            )}
          </div>
        ) : null}

        {queuedIntegrations.map((integration) => (
          <QueuedIntegrationRow
            key={integration.domain}
            integration={integration}
            onRemove={() => onRemove(integration)}
          />
        ))}

        {integrations.length > 0 && allConnected ? (
          <div>
            <Button type="button" variant="ghost" onClick={onAddAnother}>
              Add another source
            </Button>
          </div>
        ) : null}

        {!integrations.length ? (
          <p className="text-xs leading-5 text-muted-foreground">
            No sources are queued.
          </p>
        ) : null}
      </div>

      {notice ? (
        <p className="mt-4 text-xs text-muted-foreground">{notice}</p>
      ) : null}
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
      <p className="max-w-xl text-sm leading-6 text-muted-foreground">
        You don't have to run ads yourself. Your agents can plan them, launch
        them and keep an eye on the spend, and nothing goes live without your
        OK. Roughly what could you put toward ads each month?
      </p>
      <div className="mt-2 px-1 py-3">
        <div className="text-center text-sm font-medium">{budget}</div>
        <input
          type="range"
          min={0}
          max={adsBudgetOptions.length - 1}
          value={index}
          onChange={(event) =>
            setBudget(adsBudgetOptions[Number(event.target.value)]!)
          }
          className="mt-6 h-1 w-full cursor-pointer appearance-none bg-border accent-white [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:bg-border [&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-white"
        />
        <div className="mt-4 flex justify-between text-xs text-muted-foreground">
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
  analyticsConnected,
  onContinue,
  saving,
}: {
  selected: boolean;
  setSelected: (trackAiReferrals: boolean) => void;
  analyticsConnected: boolean;
  onContinue: () => void;
  saving: boolean;
}) {
  return (
    <StepFrame onContinue={onContinue} saving={saving}>
      <p className="text-sm leading-6 text-muted-foreground">
        AI assistants increasingly recommend products before buyers visit your
        site. Marketer watches analytics for AI referrals and reports what is
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
      {analyticsConnected ? (
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          Uses your existing analytics connection, so there is nothing else to
          set up.
        </p>
      ) : null}
    </StepFrame>
  );
}
function PricingControl({
  plan,
  setPlan,
  onCheckout,
  saving,
}: {
  plan: BillingPlan;
  setPlan: (plan: BillingPlan) => void;
  onCheckout: () => void;
  saving: boolean;
}) {
  return (
    <div className="border bg-card p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setPlan("monthly")}
          className={cn(
            "border p-5 text-left transition-colors hover:border-foreground",
            plan === "monthly" && "border-foreground",
          )}
        >
          <span className="text-sm font-medium">Monthly</span>
          <span className="mt-4 block font-serif text-3xl">$49/mo</span>
          <span className="mt-2 block text-xs leading-5 text-muted-foreground">
            Per workspace. Card required for the free trial.
          </span>
        </button>
        <button
          type="button"
          onClick={() => setPlan("annual")}
          className={cn(
            "border p-5 text-left transition-colors hover:border-foreground",
            plan === "annual" && "border-foreground",
          )}
        >
          <span className="text-sm font-medium">Annual</span>
          <span className="mt-4 block font-serif text-3xl">$44/mo</span>
          <span className="mt-2 block text-xs leading-5 text-muted-foreground">
            10% off. Billed yearly at $529.
          </span>
        </button>
      </div>
      <div className="mt-5 flex justify-end border-t pt-4">
        <Button
          type="button"
          onClick={() => void onCheckout()}
          disabled={saving}
        >
          {saving ? "Opening..." : "Open checkout"}
        </Button>
      </div>
    </div>
  );
}

function CompletionControl({
  onContinue,
  saving,
}: {
  onContinue: () => void;
  saving: boolean;
}) {
  return (
    <div className="flex min-h-[480px] w-full items-center justify-center border bg-card px-6 py-14">
      <div className="flex max-w-sm flex-col items-center text-center">
        <SuccessCheck className="mb-8" />
        <div className="success-copy flex flex-col items-center">
          <h2 className="font-serif text-4xl leading-none">You're in.</h2>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Your workspace is ready. Your agents have what they need to begin.
          </p>
          <Button
            type="button"
            className="mt-9"
            onClick={onContinue}
            disabled={saving}
          >
            {saving ? "Saving..." : "Go to dashboard"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function OnboardingPage() {
  const { cloudOrganizationId, user, signOut } = useAuth();
  const { status: runtimeStatus } = useRuntime();
  const { isAuthenticated: convexReady } = useConvexAuth();
  const upsertSocial = useMutation(api.socialAccounts.upsert);
  const removeSocial = useMutation(api.socialAccounts.remove);
  const saveAnalyticsProperty = useMutation(api.googleAnalytics.saveProperty);
  const saveAnalyticsSnapshot = useMutation(api.analyticsSnapshots.upsert);
  const markIntegrationConnected = useMutation(api.integrations.markConnected);
  const analyticsConnection = useQuery(
    api.googleAnalytics.connectionStatus,
    convexReady && cloudOrganizationId ? {} : "skip",
  );
  const connectedChannels = useQuery(
    api.integrations.listConnected,
    convexReady && cloudOrganizationId ? {} : "skip",
  );
  const analyticsConfigStatus = useQuery(
    api.googleAnalytics.oauthConfigStatus,
    convexReady && cloudOrganizationId ? {} : "skip",
  );
  const socialAccounts = useQuery(
    api.socialAccounts.list,
    convexReady && cloudOrganizationId ? {} : "skip",
  );
  const subscription = useQuery(
    api.billing.getSubscription,
    convexReady && cloudOrganizationId ? {} : "skip",
  );

  const [org, setOrg] = useState<AuthOrganization | null>(null);
  const [draft, setDraft] = useState<OnboardingDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<BillingPlan>("monthly");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectingAnalytics, setConnectingAnalytics] = useState(false);
  // The setup agent's latest verified result: bridges the gap until the
  // listConnected query refreshes (provider, category, display name).
  const [setupConnectedProvider, setSetupConnectedProvider] = useState<
    string | null
  >(null);
  const [setupConnectedCategory, setSetupConnectedCategory] = useState<
    "analytics" | "ads" | null
  >(null);
  const [setupPreview, setSetupPreview] = useState<SetupResult | null>(null);
  const latestRef = useRef<HTMLDivElement | null>(null);
  // Deep link: /onboarding?step=analytics reopens setup at that step (the
  // dashboard's finish-setting-up card uses this to resume skipped items).
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
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
  }, [cloudOrganizationId, user?.name]);

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
        nextSocials[account.platform as SocialPlatform] = account.handle;
      }
      return { ...current, socials: nextSocials };
    });
  }, [socialAccounts]);

  const step = draft?.step ?? "context";
  const currentIndex = steps.indexOf(step);
  const connectedAnalytics =
    analyticsConnection?.channel?.status === "connected";
  const billingActive = hasWorkspaceAccess(subscription);
  const billingResolved = subscription !== undefined;

  useEffect(() => {
    if (!draft || !billingResolved) return;

    if (billingActive && draft.step === "pricing") {
      setNotice(null);
      setError(null);
      setDraft((current) =>
        current?.step === "pricing" ? { ...current, step: "finish" } : current,
      );
      return;
    }

    if (!billingActive && draft.step === "finish") {
      setNotice(null);
      setDraft((current) =>
        current?.step === "finish" ? { ...current, step: "pricing" } : current,
      );
    }
  }, [billingActive, billingResolved, draft?.step]);

  useEffect(() => {
    let ticks = 0;
    const scrollLatestIntoView = () => {
      latestRef.current?.scrollIntoView({ block: "end" });
    };

    scrollLatestIntoView();
    const interval = window.setInterval(() => {
      ticks += 1;
      scrollLatestIntoView();
      if (ticks >= 14) window.clearInterval(interval);
    }, 120);

    return () => window.clearInterval(interval);
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

  const clearAnalyticsSelection = useCallback(() => {
    setNotice(null);
    setError(null);
    setDraft((current) =>
      current
        ? {
            ...current,
            analytics: { ...current.analytics, integrations: [] },
            step: "ads",
          }
        : current,
    );
  }, []);

  const clearAdsSelection = useCallback((nextStep: "adsBudget" | "aeo") => {
    setNotice(null);
    setError(null);
    setDraft((current) =>
      current
        ? {
            ...current,
            ads: { ...current.ads, integrations: [] },
            step: nextStep,
          }
        : current,
    );
  }, []);

  const goNext = useCallback(() => {
    setNotice(null);
    setError(null);
    setDraft((current) => {
      if (!current) return current;
      const next = steps[steps.indexOf(current.step) + 1] ?? "finish";
      return { ...current, step: next };
    });
  }, []);

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
      const nextDraft = { ...draft, step: "socials" as StepKey };
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
    await updateAuthOrganization(org.id, {
      name: draft.companyName.trim() || org.name,
      ...(!org.logo && logo ? { logo } : {}),
      metadata: { ...metadata, websiteUrl: draft.websiteUrl.trim() },
    });
    setOrg({
      ...org,
      name: draft.companyName.trim() || org.name,
      logo: org.logo ?? logo,
      metadata: { ...metadata, websiteUrl: draft.websiteUrl.trim() },
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
    if (draft.provider === "claude" || draft.provider === "codex") {
      if (org) setWorkspaceProvider(org.id, draft.provider);
    }
  }, [draft, org]);

  const completeOnboarding = useCallback(async () => {
    if (!org || !draft) return;
    if (!billingActive) {
      setDraft((current) =>
        current ? { ...current, step: "pricing" } : current,
      );
      setError("Complete checkout before continuing to the dashboard.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await persistContext();
      await persistSocials();
      persistProvider();
      const metadata = parseOrganizationMetadata(org);
      await updateAuthOrganization(org.id, {
        name: draft.companyName.trim() || org.name,
        metadata: {
          ...metadata,
          websiteUrl: draft.websiteUrl.trim(),
          onboarding: {
            ...(metadata.onboarding && typeof metadata.onboarding === "object"
              ? (metadata.onboarding as Record<string, unknown>)
              : {}),
            provider: draft.provider,
            providerMode: draft.providerMode,
            workspaceMode: draft.workspaceMode,
            cloudDeploymentUrl: draft.cloudDeploymentUrl.trim(),
            goals: draft.goals,
            monitoring: draft.monitoring,
            analytics: draft.analytics,
            ads: draft.ads,
            aeo: draft.aeo,
            completedAt: new Date().toISOString(),
          },
        },
      });
      localStorage.removeItem(storageKey(org.id));
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [
    billingActive,
    draft,
    org,
    persistContext,
    persistProvider,
    persistSocials,
  ]);

  const advance = useCallback(async () => {
    if (!draft || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (step === "context" && (await persistContext())) return;
      if (step === "socials") await persistSocials();
      if (step === "inference") persistProvider();
      if (step === "finish") {
        await completeOnboarding();
        return;
      }
      if (step === "adsConnect") {
        // Connecters already run campaigns; anyone who emptied the queue
        // gets the budget question they'd otherwise have skipped.
        setNotice(null);
        setError(null);
        setDraft((current) =>
          current
            ? {
                ...current,
                step: current.ads.integrations.length > 0 ? "aeo" : "adsBudget",
              }
            : current,
        );
        return;
      }
      goNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [
    completeOnboarding,
    draft,
    goNext,
    persistContext,
    persistProvider,
    persistSocials,
    saving,
    step,
  ]);

  const handleSetupResult = useCallback(
    (result: SetupResult, category: "analytics" | "ads") => {
      void persistSetupResult(
        result,
        {
          saveProperty: saveAnalyticsProperty,
          markConnected: markIntegrationConnected,
          saveSnapshot: saveAnalyticsSnapshot,
        },
        category,
      )
        .then(() => {
          setSetupConnectedProvider(String(result.provider));
          setSetupConnectedCategory(category);
          setSetupPreview(result);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
        });
    },
    [markIntegrationConnected, saveAnalyticsProperty, saveAnalyticsSnapshot],
  );

  const startAnalyticsConnect = useCallback(async () => {
    setConnectingAnalytics(true);
    setNotice(null);
    setError(null);
    const result = await connectGoogleAnalytics();
    setConnectingAnalytics(false);
    if (result.status === "configurationRequired") {
      setNotice(
        "Google Analytics is saved for this workspace. OAuth is not enabled for this build yet, so you can continue and connect it later.",
      );
      return;
    }
    if (result.status === "error") {
      setError(result.message);
      return;
    }
    setNotice(
      "Google consent opened in your browser. Return here after approval.",
    );
  }, []);

  const startCheckout = useCallback(async () => {
    setSaving(true);
    setNotice(null);
    setError(null);
    const result = await openWorkspaceCheckout(checkoutPlan);
    setSaving(false);
    if (result.status === "unavailable") {
      setNotice("Billing is not set up yet.");
      return;
    }
    if (result.status === "error") {
      setError(result.message);
      return;
    }
  }, [checkoutPlan]);

  const currentControl = useMemo(() => {
    if (!draft) return null;
    const connectedForIntegration = (
      integration: IntegrationSearchResult,
      includeGoogleAnalyticsConnection = false,
      category?: "analytics" | "ads",
    ) => {
      return Boolean(
        (connectedChannels ?? []).some(
          (channel) =>
            (!category || channel.category === category) &&
            integrationProviderMatches(integration, channel.provider),
        ) ||
        (setupConnectedProvider &&
          (!category || setupConnectedCategory === category) &&
          integrationProviderMatches(integration, setupConnectedProvider)) ||
        (includeGoogleAnalyticsConnection &&
          isGoogleAnalyticsIntegration(integration) &&
          connectedAnalytics),
      );
    };
    const channelsInCategory = (category: "analytics" | "ads") => {
      const channels: ConnectedChannel[] = (connectedChannels ?? [])
        .filter((channel) => channel.category === category)
        .map((channel) => ({
          provider: channel.provider,
          displayName: channel.displayName,
          category: channel.category,
        }));

      if (
        category === "analytics" &&
        connectedAnalytics &&
        !channels.some((channel) => channel.provider === "google-analytics")
      ) {
        channels.push({
          provider: "google-analytics",
          displayName:
            analyticsConnection?.channel?.displayName ?? "Google Analytics",
          category,
        });
      }

      if (
        setupConnectedProvider &&
        setupConnectedCategory === category &&
        !channels.some((channel) => channel.provider === setupConnectedProvider)
      ) {
        channels.push({
          provider: setupConnectedProvider,
          displayName:
            setupPreview?.displayName ??
            providerIdentity(setupConnectedProvider).label,
          category,
        });
      }

      return channels;
    };

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
          onContinue={advance}
          saving={saving}
        />
      );
    }
    if (step === "health") {
      return (
        <HealthControl
          draft={draft}
          runtimeStatus={runtimeStatus}
          convexReady={convexReady}
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
    if (step === "analyticsConnect") {
      return (
        <IntegrationConnectQueueControl
          category="analytics"
          integrations={draft.analytics.integrations}
          workspaceMode={draft.workspaceMode}
          provider={
            draft.provider === "claude" || draft.provider === "codex"
              ? draft.provider
              : null
          }
          channels={channelsInCategory("analytics")}
          onAddAnother={() =>
            setDraft((current) =>
              current ? { ...current, step: "analytics" } : current,
            )
          }
          onRemove={(integration) =>
            setAnalyticsIntegrations(
              draft.analytics.integrations.filter(
                (item) => item.domain !== integration.domain,
              ),
            )
          }
          connectedForIntegration={(integration) =>
            connectedForIntegration(integration, true, "analytics")
          }
          configStatus={analyticsConfigStatus}
          connecting={connectingAnalytics}
          notice={notice}
          onConnect={() => void startAnalyticsConnect()}
          onSetupResult={(result) => handleSetupResult(result, "analytics")}
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
          onEmptySelection={() => clearAdsSelection("adsBudget")}
          onSkip={() => clearAdsSelection("aeo")}
          onContinue={advance}
          saving={saving}
        />
      );
    }
    if (step === "adsConnect") {
      return (
        <IntegrationConnectQueueControl
          category="ads"
          integrations={draft.ads.integrations}
          workspaceMode={draft.workspaceMode}
          provider={
            draft.provider === "claude" || draft.provider === "codex"
              ? draft.provider
              : null
          }
          channels={channelsInCategory("ads")}
          onAddAnother={() =>
            setDraft((current) =>
              current ? { ...current, step: "ads" } : current,
            )
          }
          onRemove={(integration) =>
            setAdsIntegrations(
              draft.ads.integrations.filter(
                (item) => item.domain !== integration.domain,
              ),
            )
          }
          connectedForIntegration={(integration) =>
            connectedForIntegration(integration, false, "ads")
          }
          configStatus={undefined}
          connecting={false}
          notice={null}
          onConnect={() => undefined}
          onSetupResult={(result) => handleSetupResult(result, "ads")}
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
    if (step === "aeo") {
      return (
        <AeoControl
          selected={draft.aeo.trackAiReferrals}
          setSelected={(trackAiReferrals) => setAeo({ trackAiReferrals })}
          analyticsConnected={draft.analytics.integrations.some((integration) =>
            connectedForIntegration(integration, true, "analytics"),
          )}
          onContinue={advance}
          saving={saving}
        />
      );
    }
    if (step === "pricing") {
      return (
        <PricingControl
          plan={checkoutPlan}
          setPlan={setCheckoutPlan}
          onCheckout={startCheckout}
          saving={saving}
        />
      );
    }
    return (
      <CompletionControl
        onContinue={() => void completeOnboarding()}
        saving={saving}
      />
    );
  }, [
    advance,
    analyticsConnection?.channel?.displayName,
    analyticsConfigStatus,
    checkoutPlan,
    completeOnboarding,
    connectedAnalytics,
    connectedChannels,
    connectingAnalytics,
    convexReady,
    draft,
    handleSetupResult,
    notice,
    setupConnectedCategory,
    setupConnectedProvider,
    runtimeStatus,
    saving,
    setField,
    setGoals,
    setAeo,
    setAdsIntegrations,
    setAdsBudget,
    setAnalyticsIntegrations,
    clearAdsSelection,
    clearAnalyticsSelection,
    setMonitoring,
    setSocial,
    socialAccounts,
    startAnalyticsConnect,
    startCheckout,
    step,
  ]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading workspace...
      </div>
    );
  }

  if (!draft) return <Navigate to="/workspaces/new" replace />;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <UserIndicator user={user} onSignOut={signOut} />
      <header data-tauri-drag-region className="h-[72px] shrink-0" />
      <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-6 pb-6">
        <div className="min-h-0 flex-1 space-y-7 overflow-y-auto pr-1 pb-6">
          {steps
            .slice(0, currentIndex)
            .filter(
              // Steps the user never saw don't replay in the transcript.
              (pastStep) =>
                !(
                  (pastStep === "analyticsConnect" &&
                    draft.analytics.integrations.length === 0) ||
                  (pastStep === "adsConnect" &&
                    draft.ads.integrations.length === 0) ||
                  (pastStep === "adsBudget" &&
                    draft.ads.integrations.length > 0)
                ),
            )
            .map((pastStep) => (
              <div key={pastStep} className="space-y-3">
                <AgentBubble text={questions[pastStep]} />
                <AnswerPreview step={pastStep} draft={draft} />
              </div>
            ))}
          <div className="space-y-4">
            {step === "finish" ? null : (
              <AgentBubble text={questions[step]} current />
            )}
            <div className="w-full max-w-[720px]">{currentControl}</div>
            <div className="min-h-5">
              {notice && step !== "analytics" ? (
                <p className="text-xs text-muted-foreground">{notice}</p>
              ) : null}
              {error ? (
                <p className="break-words text-xs text-destructive">{error}</p>
              ) : null}
            </div>
          </div>
          <div ref={latestRef} />
        </div>
      </main>
    </div>
  );
}
