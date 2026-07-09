import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router";
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
import { openWorkspaceCheckout, type BillingPlan } from "../lib/billing";
import { connectGoogleAnalytics } from "../lib/google-analytics";
import {
  persistSetupResult,
  type SetupResult,
} from "../lib/integration-setup";
import { IntegrationConnect } from "../components/integrations/integration-connect";
import { ConnectionPreview } from "../components/integrations/connection-preview";
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
  | "pricing"
  | "finish";

interface OnboardingDraft {
  workspaceMode: "local" | "cloud";
  companyName: string;
  websiteUrl: string;
  socials: Partial<Record<SocialPlatform, string>>;
  providerMode: "local" | "deployed";
  /** Null until the user explicitly picks an agent app — never defaulted. */
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
    integration: IntegrationSearchResult | null;
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
  "pricing",
  "finish",
];

const questions: Record<StepKey, string> = {
  mode: "First, where should this workspace run?",
  inference: "Which agent app should Marketer use?",
  health: "Quick check before we teach Marketer about your business.",
  context:
    "I'll set this workspace up around one company, so the agents know exactly who they're working for. Is this the right company and website?",
  socials:
    "Nice. Now add the public accounts the agents should learn from and write for.",
  selling: "Describe what you're selling in a few short words.",
  audience: "Who is your ideal customer?",
  success: "What would make the next 90 days feel like this is working?",
  time: "How much time can you spend on marketing each week?",
  monitoring: "Where should your agents look for prospects and mentions?",
  analytics: "Which analytics platform do you use today?",
  analyticsConnect: "Got it. Let me set up that analytics source for you.",
  pricing: "Choose how this workspace is billed.",
  finish: "Workspace setup is ready.",
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

const monitoringOptions = [
  { key: "x", label: "X", platform: "x" as const, Icon: Twitter },
  { key: "facebook", label: "Facebook", Icon: Facebook },
  { key: "instagram", label: "Instagram", platform: "instagram" as const, Icon: Instagram },
  { key: "reddit", label: "Reddit", platform: "reddit" as const, Icon: MessageCircle },
  { key: "linkedin", label: "LinkedIn", Icon: Linkedin },
  { key: "youtube", label: "YouTube", platform: "youtube" as const, Icon: Youtube },
  { key: "search", label: "Search", Icon: Search },
  { key: "communities", label: "Communities", Icon: Globe },
];

const noAnalyticsIntegration: IntegrationSearchResult = {
  domain: "none",
  name: "Not yet",
  description: "Continue without connecting analytics for now.",
  kinds: [],
  url: "https://integrations.sh/?q=analytics",
};

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
    description: "Product analytics and event data through the PostHog MCP server.",
    kinds: ["mcp"],
    url: "https://integrations.sh/posthog.com/",
  },
  {
    domain: "pendo.io",
    name: "Pendo",
    description: "Product analytics and behavioral data through MCP and API surfaces.",
    kinds: ["mcp", "openapi"],
    url: "https://integrations.sh/pendo.io/",
  },
  {
    domain: "mixpanel.com",
    name: "Mixpanel",
    description: "Product analytics integration from the integrations.sh registry.",
    kinds: ["mcp"],
    url: "https://integrations.sh/mixpanel.com/",
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

function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
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
      integration: fallbackAnalyticsIntegrations[0] ?? null,
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

function draftFromOrg(org: AuthOrganization, userName?: string): OnboardingDraft {
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
      onboarding.workspaceMode === "cloud" || onboarding.providerMode === "deployed"
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
        typeof monitoring.keywords === "string"
          ? monitoring.keywords
          : "",
    },
    step: "mode",
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
      | Partial<OnboardingDraft["analytics"]> & {
          platform?: string;
        }
      | undefined;
    const legacyPlatform =
      parsedAnalytics?.platform === "none"
        ? noAnalyticsIntegration
        : parsedAnalytics?.platform === "posthog"
          ? fallbackAnalyticsIntegrations.find(
              (integration) => integration.domain === "posthog.com",
            )
          : parsedAnalytics?.platform === "plausible"
            ? {
                domain: "plausible.io",
                name: "Plausible",
                description: "Privacy-friendly web analytics.",
                kinds: ["openapi"],
                url: "https://integrations.sh/plausible.io/",
              }
            : parsedAnalytics?.platform === "google-analytics"
              ? fallbackAnalyticsIntegrations[0]
              : undefined;
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
        ...base.analytics,
        ...(parsedAnalytics ?? {}),
        integration:
          parsedAnalytics?.integration ?? legacyPlatform ?? base.analytics.integration,
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
    <BrandIcon icon={platform ? socialIcons[platform] : undefined} label={label} />
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

function connectedAnalyticsLabel(
  integration: IntegrationSearchResult | null | undefined,
  connected: boolean,
) {
  if (!integration) return "No analytics source selected";
  if (integration.domain === "none") return "Not connected yet";
  return connected ? `${integration.name} connected` : `${integration.name} selected`;
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
    return (
      <UserBubble>
        {draft.goals.selling || "Product not set"}
      </UserBubble>
    );
  }

  if (step === "audience") {
    return <UserBubble>{draft.goals.audience || "Audience not set"}</UserBubble>;
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
        {draft.analytics.integration?.name ?? "Analytics selected"}
      </UserBubble>
    );
  }

  if (step === "analyticsConnect") {
    if (draft.analytics.integration?.domain === "none") {
      return <UserBubble>Not connected yet</UserBubble>;
    }
    return (
      <UserBubble>
        {connectedAnalyticsLabel(draft.analytics.integration, false)}
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
          onClick={() =>
            setField({ providerMode: "local", provider: "codex" })
          }
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

function AnalyticsControl({
  selected,
  setSelected,
  onNoAnalytics,
  onSkip,
  onContinue,
  saving,
}: {
  selected: IntegrationSearchResult | null;
  setSelected: (integration: IntegrationSearchResult) => void;
  onNoAnalytics: () => void;
  onSkip: () => void;
  onContinue: () => void;
  saving: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IntegrationSearchResult[]>(
    fallbackAnalyticsIntegrations,
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const trimmed = query.trim() || "analytics";
    setLoading(true);
    const timeout = window.setTimeout(() => {
      void searchIntegrations(trimmed)
        .then((items) => {
          if (cancelled) return;
          setResults(items.length ? items : fallbackAnalyticsIntegrations);
        })
        .catch(() => {
          if (!cancelled) setResults(fallbackAnalyticsIntegrations);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [query]);

  const options = useMemo(() => {
    const seen = new Set<string>();
    return [...fallbackAnalyticsIntegrations, ...results].filter((integration) => {
      if (seen.has(integration.domain)) return false;
      seen.add(integration.domain);
      return true;
    });
  }, [results]);

  return (
    <StepFrame
      onContinue={onContinue}
      saving={saving}
      disabled={!selected}
      continueLabel="Continue"
      actionsLeft={
        <>
          <Button type="button" variant="ghost" onClick={onNoAnalytics}>
            I don’t use analytics
          </Button>
          <Button type="button" variant="ghost" onClick={onSkip}>
            Skip for now
          </Button>
        </>
      }
    >
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search analytics tools"
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
            selected={selected?.domain === integration.domain}
            onClick={() => setSelected(integration)}
          />
        ))}
      </div>
    </StepFrame>
  );
}

function AnalyticsConnectControl({
  integration,
  workspaceMode,
  provider,
  connected,
  displayName,
  channels,
  preview,
  onAddAnother,
  configStatus,
  connecting,
  notice,
  onConnect,
  onSetupResult,
  onContinue,
  saving,
}: {
  integration: IntegrationSearchResult | null;
  workspaceMode: OnboardingDraft["workspaceMode"];
  provider: DriverType | null;
  connected: boolean;
  displayName?: string;
  channels: Array<{ provider: string; displayName: string }> | undefined;
  preview: SetupResult | null;
  onAddAnother: () => void;
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
  const connectable = Boolean(integration && integration.domain !== "none");
  const localAgentSetup =
    workspaceMode === "local" && connectable && provider !== null;
  const oauthStatusText = connected
    ? `Connected to ${displayName ?? "Google Analytics"}.`
    : configStatus?.configured
      ? `OAuth is ready from ${configStatus.source}.`
      : configStatus === undefined
        ? "Checking Google OAuth setup..."
        : "Google Analytics is saved as your analytics source. The cloud workspace needs Google OAuth enabled before you can connect it.";
  const canConnectGoogleAnalytics = Boolean(configStatus?.configured);

  return (
    <StepFrame
      onContinue={onContinue}
      saving={saving}
      // A chosen local integration must finish connecting before onboarding
      // moves on; a half-connected workspace is worse than a slower step.
      disabled={localAgentSetup && !connected}
      continueLabel={
        !connectable ||
        connected ||
        localAgentSetup ||
        !isGoogleAnalyticsIntegration(integration)
          ? "Continue"
          : canConnectGoogleAnalytics
            ? "Continue without connecting"
            : "Save source and continue"
      }
    >
      {integration ? (
        <div className="flex items-start gap-3 border bg-background p-4">
          <IntegrationLogo integration={integration} />
          <div className="min-w-0">
            <p className="text-sm font-medium">{integration.name}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {integration.description}
            </p>
            {integration.url ? (
              <a
                className="mt-2 inline-block text-xs text-muted-foreground hover:text-foreground"
                href={integration.url}
                target="_blank"
                rel="noreferrer"
              >
                View integration facts
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {connectable && integration ? (
        <div className="mt-5 border-t pt-5">
          {localAgentSetup && provider ? (
            <div className="space-y-3">
              {channels?.length ? (
                <div className="divide-y border bg-background px-4">
                  {channels.map((channel) => (
                    <div
                      key={channel.provider}
                      className="flex items-center gap-3 py-2.5"
                    >
                      <CheckCircle2
                        size={15}
                        className="shrink-0 text-emerald-500"
                      />
                      <span className="min-w-0 truncate text-sm">
                        {channel.displayName}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        Connected
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {connected && preview?.series?.length ? (
                <ConnectionPreview
                  name={preview.displayName ?? integration.name}
                  metricLabel={preview.metricLabel}
                  series={preview.series}
                />
              ) : null}
              {!connected ? (
                <IntegrationConnect
                  integration={integration}
                  driver={provider}
                  connected={false}
                  onResult={onSetupResult}
                />
              ) : (
                <div>
                  <Button type="button" variant="ghost" onClick={onAddAnother}>
                    Add another source
                  </Button>
                </div>
              )}
            </div>
          ) : isGoogleAnalyticsIntegration(integration) ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs leading-5 text-muted-foreground">
                {oauthStatusText}
              </p>
              {!connected && canConnectGoogleAnalytics ? (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={onConnect}
                    disabled={connecting}
                  >
                    {connecting ? "Opening..." : "Connect"}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-xs leading-5 text-muted-foreground">
              Saved as this workspace&apos;s analytics source.
            </p>
          )}
        </div>
      ) : null}

      {notice ? (
        <p className="mt-4 text-xs text-muted-foreground">{notice}</p>
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
          {saving ? "Opening..." : "Start free trial"}
        </Button>
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

  const [org, setOrg] = useState<AuthOrganization | null>(null);
  const [draft, setDraft] = useState<OnboardingDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<BillingPlan>("monthly");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectingAnalytics, setConnectingAnalytics] = useState(false);
  // Provider id the setup agent just verified (covers the gap until the
  // listConnected query refreshes) and its live data preview.
  const [setupConnectedProvider, setSetupConnectedProvider] = useState<
    string | null
  >(null);
  const [setupPreview, setSetupPreview] = useState<SetupResult | null>(null);
  const latestRef = useRef<HTMLDivElement | null>(null);

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
      setDraft(active ? loadDraft(active, user?.name) : loadPendingDraft());
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

  const setAnalyticsIntegration = useCallback(
    (integration: IntegrationSearchResult) => {
      setDraft((current) =>
        current
          ? { ...current, analytics: { ...current.analytics, integration } }
          : current,
      );
    },
    [],
  );

  const finishAnalyticsSelection = useCallback(
    (integration: IntegrationSearchResult) => {
      setNotice(null);
      setError(null);
      setDraft((current) =>
        current
          ? {
              ...current,
              analytics: { ...current.analytics, integration },
              step: "pricing",
            }
          : current,
      );
    },
    [],
  );

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
    if (!org) {
      const name = draft.companyName.trim();
      if (!name) return false;
      const created = await createAuthOrganization({
        name,
        slug: slugify(name),
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
      metadata: { ...metadata, websiteUrl: draft.websiteUrl.trim() },
    });
    setOrg({
      ...org,
      name: draft.companyName.trim() || org.name,
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
      setWorkspaceProvider(draft.provider);
    }
  }, [draft]);

  const completeOnboarding = useCallback(async () => {
    if (!org || !draft) return;
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
  }, [draft, org, persistContext, persistProvider, persistSocials]);

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
    (result: SetupResult) => {
      void persistSetupResult(
        result,
        {
          saveProperty: saveAnalyticsProperty,
          markConnected: markIntegrationConnected,
        },
        "analytics",
      )
        .then(() => {
          setSetupConnectedProvider(String(result.provider));
          setSetupPreview(result);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
        });
    },
    [markIntegrationConnected, saveAnalyticsProperty],
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
    setNotice("Checkout opened in your browser.");
    setDraft((current) => (current ? { ...current, step: "finish" } : current));
  }, [checkoutPlan]);

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
        <AnalyticsControl
          selected={draft.analytics.integration}
          setSelected={setAnalyticsIntegration}
          onNoAnalytics={() => finishAnalyticsSelection(noAnalyticsIntegration)}
          onSkip={() => finishAnalyticsSelection(noAnalyticsIntegration)}
          onContinue={advance}
          saving={saving}
        />
      );
    }
    if (step === "analyticsConnect") {
      const currentDomain = draft.analytics.integration?.domain;
      const matchesCurrent = (provider: string) =>
        provider === currentDomain ||
        (currentDomain === "analytics.googleapis.com" &&
          provider === "google-analytics");
      const connectedForCurrent = Boolean(
        currentDomain &&
          ((connectedChannels ?? []).some((channel) =>
            matchesCurrent(channel.provider),
          ) ||
            (setupConnectedProvider &&
              matchesCurrent(setupConnectedProvider)) ||
            (currentDomain === "analytics.googleapis.com" &&
              connectedAnalytics)),
      );
      return (
        <AnalyticsConnectControl
          integration={draft.analytics.integration}
          workspaceMode={draft.workspaceMode}
          provider={
            draft.provider === "claude" || draft.provider === "codex"
              ? draft.provider
              : null
          }
          connected={connectedForCurrent}
          displayName={analyticsConnection?.channel?.displayName}
          channels={connectedChannels}
          preview={setupPreview}
          onAddAnother={() =>
            setDraft((current) =>
              current ? { ...current, step: "analytics" } : current,
            )
          }
          configStatus={analyticsConfigStatus}
          connecting={connectingAnalytics}
          notice={notice}
          onConnect={() => void startAnalyticsConnect()}
          onSetupResult={handleSetupResult}
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
      <StepFrame
        onContinue={() => void completeOnboarding()}
        saving={saving}
        continueLabel="Go to dashboard"
      >
        <p className="text-sm leading-6 text-muted-foreground">
          Your agents now have the company, channels, goals and analytics setup
          path they need to start from the right place.
        </p>
      </StepFrame>
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
    setupConnectedProvider,
    setupPreview,
    runtimeStatus,
    saving,
    setField,
    setGoals,
    setAnalyticsIntegration,
    finishAnalyticsSelection,
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
          {steps.slice(0, currentIndex).map((pastStep) => (
            <div key={pastStep} className="space-y-3">
              <AgentBubble text={questions[pastStep]} />
              <AnswerPreview step={pastStep} draft={draft} />
            </div>
          ))}
          <div className="space-y-4">
            <AgentBubble text={questions[step]} current />
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
