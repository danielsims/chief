import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@marketer/backend/convex/_generated/api";
import { defaultAgents } from "@marketer/agent-runtime/agents";
import type { DriverType } from "@marketer/agent-runtime/types";
import { Button } from "@marketer/ui/components/button";
import { Input } from "@marketer/ui/components/input";
import { PrefixedInput } from "@marketer/ui/components/prefixed-input";
import { cn } from "@marketer/ui/lib/utils";
import { useAuth } from "../lib/auth/auth-context";
import {
  type AuthOrganization,
  listAuthOrganizations,
  parseOrganizationMetadata,
  updateAuthOrganization,
} from "../lib/auth/better-auth-client";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "../lib/social-platforms";
import { setAgentOverride } from "../lib/agent-overrides";
import { useRuntime } from "../lib/runtime";
import { openWorkspaceCheckout, type BillingPlan } from "../lib/billing";

type StepKey =
  | "context"
  | "socials"
  | "inference"
  | "goalSelling"
  | "goalSuccess"
  | "goalTime"
  | "monitoring"
  | "pricing"
  | "finish";

interface OnboardingDraft {
  companyName: string;
  websiteUrl: string;
  socials: Partial<Record<SocialPlatform, string>>;
  provider: DriverType;
  goals: {
    selling: string;
    success: string;
    timeBudget: string;
  };
  monitoring: {
    channels: string;
    keywords: string;
  };
  step: StepKey;
}

const steps: StepKey[] = [
  "context",
  "socials",
  "inference",
  "goalSelling",
  "goalSuccess",
  "goalTime",
  "monitoring",
  "pricing",
  "finish",
];

const questionByStep: Record<StepKey, string> = {
  context: "Confirm the company your agents are working for.",
  socials: "Which social accounts should your agents write for?",
  inference: "Where should your agents run by default?",
  goalSelling: "What are you selling, and to whom?",
  goalSuccess: "What does success look like in 90 days?",
  goalTime: "How many hours a week can you spend on marketing?",
  monitoring: "Where should your agents look for prospects and mentions?",
  pricing: "Choose how this workspace is billed.",
  finish: "Your workspace is ready.",
};

function storageKey(orgId: string) {
  return `marketer-onboarding:${orgId}`;
}

function getStepNumber(step: StepKey) {
  if (step === "context") return 1;
  if (step === "socials") return 2;
  if (step === "inference") return 3;
  if (step === "goalSelling" || step === "goalSuccess" || step === "goalTime") {
    return 4;
  }
  if (step === "monitoring") return 5;
  if (step === "pricing") return 6;
  return 7;
}

function draftFromOrg(org: AuthOrganization): OnboardingDraft {
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

  return {
    companyName: org.name,
    websiteUrl:
      typeof metadata.websiteUrl === "string" ? metadata.websiteUrl : "",
    socials: {},
    provider: onboarding.provider === "codex" ? "codex" : "claude",
    goals: {
      selling: typeof goals.selling === "string" ? goals.selling : "",
      success: typeof goals.success === "string" ? goals.success : "",
      timeBudget: typeof goals.timeBudget === "string" ? goals.timeBudget : "",
    },
    monitoring: {
      channels:
        typeof monitoring.channels === "string" ? monitoring.channels : "",
      keywords:
        typeof monitoring.keywords === "string"
          ? monitoring.keywords
          : org.name,
    },
    step: "context",
  };
}

function loadDraft(org: AuthOrganization): OnboardingDraft {
  const base = draftFromOrg(org);
  try {
    const stored = localStorage.getItem(storageKey(org.id));
    if (!stored) return base;
    const parsed = JSON.parse(stored) as Partial<OnboardingDraft>;
    return {
      ...base,
      ...parsed,
      companyName: parsed.companyName ?? base.companyName,
      websiteUrl: parsed.websiteUrl ?? base.websiteUrl,
      socials: { ...base.socials, ...(parsed.socials ?? {}) },
      provider: parsed.provider === "codex" ? "codex" : "claude",
      goals: { ...base.goals, ...(parsed.goals ?? {}) },
      monitoring: { ...base.monitoring, ...(parsed.monitoring ?? {}) },
      step:
        parsed.step && steps.includes(parsed.step) ? parsed.step : base.step,
    };
  } catch {
    return base;
  }
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
    }, 20);
    return () => window.clearInterval(timer);
  }, [text]);

  const skip = useCallback(() => {
    setVisible(text);
    setComplete(true);
  }, [text]);

  return { visible, complete, skip };
}

function answerSummary(step: StepKey, draft: OnboardingDraft) {
  if (step === "context") {
    return [draft.companyName, draft.websiteUrl].filter(Boolean).join(" / ");
  }
  if (step === "socials") {
    const count = Object.values(draft.socials).filter(Boolean).length;
    return count ? `${count} accounts added` : "Skipped";
  }
  if (step === "inference") {
    return draft.provider === "codex" ? "Codex" : "Claude";
  }
  if (step === "goalSelling") return draft.goals.selling;
  if (step === "goalSuccess") return draft.goals.success;
  if (step === "goalTime") return draft.goals.timeBudget;
  if (step === "monitoring") {
    const hasChannels = Boolean(draft.monitoring.channels.trim());
    const hasKeywords = Boolean(draft.monitoring.keywords.trim());
    if (!hasChannels && !hasKeywords) return "Skipped";
    return [
      hasChannels ? "Channels added" : "",
      hasKeywords ? "Keywords added" : "",
    ]
      .filter(Boolean)
      .join(" / ");
  }
  if (step === "pricing") return "Trial setup";
  return "";
}

function PreviousAnswers({
  currentStep,
  draft,
  onEdit,
}: {
  currentStep: StepKey;
  draft: OnboardingDraft;
  onEdit: (step: StepKey) => void;
}) {
  const currentIndex = steps.indexOf(currentStep);
  const previous = steps
    .slice(0, currentIndex)
    .filter((step) => step !== "finish")
    .map((step) => ({ step, answer: answerSummary(step, draft) }))
    .filter(({ answer }) => answer);

  if (previous.length === 0) return null;

  return (
    <div className="space-y-5">
      {previous.map(({ step, answer }) => (
        <button
          key={step}
          type="button"
          onClick={() => onEdit(step)}
          className="group grid w-full grid-cols-[1fr_auto] gap-4 text-left"
        >
          <span className="border-l pl-4 text-sm leading-6 text-muted-foreground transition-colors group-hover:text-foreground">
            {questionByStep[step]}
          </span>
          <span className="max-w-72 truncate bg-muted px-3 py-1.5 text-sm text-foreground">
            {answer}
          </span>
        </button>
      ))}
    </div>
  );
}

function TextAnswer({
  value,
  placeholder,
  onChange,
  onAdvance,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onAdvance: () => void;
}) {
  return (
    <textarea
      autoFocus
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          onAdvance();
        }
      }}
      placeholder={placeholder}
      className="min-h-28 w-full resize-none border bg-card px-4 py-3 text-sm leading-6 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    />
  );
}

export function OnboardingPage() {
  const { cloudOrganizationId } = useAuth();
  const { agents: runtimeAgents } = useRuntime();
  const { isAuthenticated: convexReady } = useConvexAuth();
  const upsertSocial = useMutation(api.socialAccounts.upsert);
  const removeSocial = useMutation(api.socialAccounts.remove);
  const socialAccounts = useQuery(
    api.socialAccounts.list,
    convexReady ? {} : "skip",
  );

  const [org, setOrg] = useState<AuthOrganization | null>(null);
  const [draft, setDraft] = useState<OnboardingDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<BillingPlan>("monthly");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setDraft(active ? loadDraft(active) : null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [cloudOrganizationId]);

  useEffect(() => {
    if (!draft || !org) return;
    localStorage.setItem(storageKey(org.id), JSON.stringify(draft));
  }, [draft, org]);

  useEffect(() => {
    if (!draft || !socialAccounts) return;
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
  const question = questionByStep[step];
  const typed = useTypedQuestion(question);
  const agents = runtimeAgents.length > 0 ? runtimeAgents : defaultAgents;

  const setField = useCallback((patch: Partial<OnboardingDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
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

  const goToStep = useCallback((next: StepKey) => {
    setNotice(null);
    setError(null);
    setDraft((current) => (current ? { ...current, step: next } : current));
  }, []);

  const persistContext = useCallback(async () => {
    if (!org || !draft) return;
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
    for (const agent of agents) {
      setAgentOverride(agent.id, { driver: draft.provider });
    }
  }, [agents, draft]);

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
            goals: draft.goals,
            monitoring: draft.monitoring,
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
      if (step === "context") await persistContext();
      if (step === "socials") await persistSocials();
      if (step === "inference") persistProvider();
      const next = steps[steps.indexOf(step) + 1] ?? "finish";
      setDraft((current) => (current ? { ...current, step: next } : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [draft, persistContext, persistProvider, persistSocials, saving, step]);

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
    goToStep("finish");
  }, [checkoutPlan, goToStep]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading workspace...
      </div>
    );
  }

  if (!org || !draft) return <Navigate to="/workspaces/new" replace />;

  const stepNumber = getStepNumber(step);
  const currentStepIndex = steps.indexOf(step);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header data-tauri-drag-region className="h-[84px] shrink-0" />
      <main className="flex flex-1 justify-center px-8 pb-12">
        <div className="flex w-full max-w-2xl flex-col">
          <div className="mb-8 flex items-center justify-between text-xs text-muted-foreground">
            <button
              type="button"
              className="transition-colors hover:text-foreground"
              onClick={() => void completeOnboarding()}
              disabled={saving}
            >
              Skip onboarding
            </button>
            <span>{stepNumber} of 7</span>
          </div>

          <div className="flex-1 space-y-8">
            <PreviousAnswers
              currentStep={step}
              draft={draft}
              onEdit={goToStep}
            />

            <section className="space-y-5">
              <button
                type="button"
                onClick={typed.skip}
                className="block border-l pl-4 text-left text-base leading-7 text-foreground"
              >
                {typed.visible}
                {!typed.complete && (
                  <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-pulse bg-foreground" />
                )}
              </button>

              {step === "context" && (
                <div className="space-y-4 border bg-card p-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-1.5">
                      <span className="text-xs text-muted-foreground">
                        Company name
                      </span>
                      <Input
                        autoFocus
                        value={draft.companyName}
                        onChange={(event) =>
                          setField({ companyName: event.target.value })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void advance();
                        }}
                        placeholder="Acme Inc"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs text-muted-foreground">
                        Website URL
                      </span>
                      <Input
                        value={draft.websiteUrl}
                        onChange={(event) =>
                          setField({ websiteUrl: event.target.value })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void advance();
                        }}
                        placeholder="acme.com"
                      />
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Your agents use this as context.
                  </p>
                  <StepActions
                    onSkip={advance}
                    onContinue={advance}
                    saving={saving}
                    continueDisabled={!draft.companyName.trim()}
                  />
                </div>
              )}

              {step === "socials" && (
                <div className="space-y-3 border bg-card p-5">
                  {SOCIAL_PLATFORMS.map((def) => (
                    <label
                      key={def.platform}
                      className="grid gap-2 sm:grid-cols-[5rem_1fr] sm:items-center"
                    >
                      <span className="text-xs text-muted-foreground">
                        {def.label}
                      </span>
                      <PrefixedInput
                        prefix={def.prefix}
                        value={draft.socials[def.platform] ?? ""}
                        onValueChange={(handle) =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  socials: {
                                    ...current.socials,
                                    [def.platform]: handle,
                                  },
                                }
                              : current,
                          )
                        }
                        placeholder="handle"
                        disabled={!convexReady}
                      />
                    </label>
                  ))}
                  <StepActions
                    onSkip={advance}
                    onContinue={advance}
                    saving={saving}
                    continueDisabled={!convexReady}
                  />
                  {!convexReady && (
                    <p className="text-xs text-muted-foreground">
                      Connecting to your workspace...
                    </p>
                  )}
                </div>
              )}

              {step === "inference" && (
                <div className="grid gap-3">
                  <ProviderCard
                    title="Claude"
                    detail="Local. Runs on this machine with your existing subscription."
                    selected={draft.provider === "claude"}
                    onClick={() => setField({ provider: "claude" })}
                  />
                  <ProviderCard
                    title="Codex"
                    detail="Local. Runs on this machine with your existing subscription."
                    selected={draft.provider === "codex"}
                    onClick={() => setField({ provider: "codex" })}
                  />
                  <ProviderCard
                    title="Vercel"
                    detail="Deployed. Coming soon."
                    selected={false}
                    disabled
                    onClick={() => {}}
                  />
                  <StepActions
                    onSkip={advance}
                    onContinue={advance}
                    saving={saving}
                  />
                </div>
              )}

              {step === "goalSelling" && (
                <div className="space-y-4">
                  <TextAnswer
                    value={draft.goals.selling}
                    onChange={(value) => setGoals({ selling: value })}
                    onAdvance={advance}
                    placeholder="A product that helps solo founders find qualified leads."
                  />
                  <StepActions
                    onSkip={advance}
                    onContinue={advance}
                    saving={saving}
                  />
                </div>
              )}

              {step === "goalSuccess" && (
                <div className="space-y-4">
                  <TextAnswer
                    value={draft.goals.success}
                    onChange={(value) => setGoals({ success: value })}
                    onAdvance={advance}
                    placeholder="For example: first $5k MRR, 100 signups or 10 active customers."
                  />
                  <StepActions
                    onSkip={advance}
                    onContinue={advance}
                    saving={saving}
                  />
                </div>
              )}

              {step === "goalTime" && (
                <div className="space-y-4">
                  <Input
                    autoFocus
                    value={draft.goals.timeBudget}
                    onChange={(event) =>
                      setGoals({ timeBudget: event.target.value })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void advance();
                    }}
                    placeholder="5 hours"
                    className="bg-card"
                  />
                  <StepActions
                    onSkip={advance}
                    onContinue={advance}
                    saving={saving}
                  />
                </div>
              )}

              {step === "monitoring" && (
                <div className="space-y-4 border bg-card p-5">
                  <label className="space-y-1.5">
                    <span className="text-xs text-muted-foreground">
                      Channels
                    </span>
                    <textarea
                      autoFocus
                      value={draft.monitoring.channels}
                      onChange={(event) =>
                        setMonitoring({ channels: event.target.value })
                      }
                      placeholder={
                        "r/startups\nX search: marketing automation\nIndie Hackers"
                      }
                      className="min-h-28 w-full resize-none border bg-transparent px-3 py-2 text-sm leading-6 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs text-muted-foreground">
                      Keywords
                    </span>
                    <Input
                      value={draft.monitoring.keywords}
                      onChange={(event) =>
                        setMonitoring({ keywords: event.target.value })
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void advance();
                      }}
                      placeholder={`${draft.companyName}, marketing, leads`}
                    />
                  </label>
                  <StepActions
                    onSkip={advance}
                    onContinue={advance}
                    saving={saving}
                  />
                </div>
              )}

              {step === "pricing" && (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <PlanCard
                      title="Monthly"
                      price="$--/mo"
                      detail="Pay per workspace. Cancel before the trial ends."
                      selected={checkoutPlan === "monthly"}
                      onClick={() => setCheckoutPlan("monthly")}
                    />
                    <PlanCard
                      title="Annual"
                      price="$--/mo"
                      detail="Lower yearly rate once pricing is decided."
                      selected={checkoutPlan === "annual"}
                      onClick={() => setCheckoutPlan("annual")}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void completeOnboarding()}
                      disabled={saving}
                    >
                      Skip for now
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void startCheckout()}
                      disabled={saving}
                    >
                      {saving ? "Opening..." : "Start free trial"}
                    </Button>
                  </div>
                </div>
              )}

              {step === "finish" && (
                <div className="border bg-card p-5">
                  <p className="text-sm leading-6 text-muted-foreground">
                    Your agents now have the company, channels and goals they
                    need to start from the right place.
                  </p>
                  <div className="mt-5 flex justify-end">
                    <Button
                      type="button"
                      onClick={() => void completeOnboarding()}
                      disabled={saving}
                    >
                      {saving ? "Finishing..." : "Finish setup"}
                    </Button>
                  </div>
                </div>
              )}
            </section>
          </div>

          <div className="mt-6 min-h-5">
            {notice && (
              <p className="text-xs text-muted-foreground">{notice}</p>
            )}
            {error && (
              <p className="break-words text-xs text-destructive">{error}</p>
            )}
          </div>

          {currentStepIndex > 0 && (
            <button
              type="button"
              onClick={() => goToStep(steps[currentStepIndex - 1])}
              className="mt-4 self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
              disabled={saving}
            >
              Back
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

function StepActions({
  onSkip,
  onContinue,
  saving,
  continueDisabled,
}: {
  onSkip: () => void;
  onContinue: () => void;
  saving: boolean;
  continueDisabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-3 border-t pt-4">
      <Button
        type="button"
        variant="outline"
        onClick={() => void onSkip()}
        disabled={saving}
      >
        Skip
      </Button>
      <Button
        type="button"
        onClick={() => void onContinue()}
        disabled={saving || continueDisabled}
      >
        {saving ? "Saving..." : "Continue"}
      </Button>
    </div>
  );
}

function ProviderCard({
  title,
  detail,
  selected,
  disabled,
  onClick,
}: {
  title: string;
  detail: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "border bg-card p-4 text-left transition-colors hover:border-foreground disabled:cursor-not-allowed disabled:opacity-45",
        selected && "border-foreground",
      )}
    >
      <span className="block text-sm font-medium">{title}</span>
      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
        {detail}
      </span>
    </button>
  );
}

function PlanCard({
  title,
  price,
  detail,
  selected,
  onClick,
}: {
  title: string;
  price: string;
  detail: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "border bg-card p-5 text-left transition-colors hover:border-foreground",
        selected && "border-foreground",
      )}
    >
      <span className="block text-sm font-medium">{title}</span>
      <span className="mt-4 block font-serif text-3xl">{price}</span>
      <span className="mt-3 block text-xs leading-5 text-muted-foreground">
        {detail}
      </span>
    </button>
  );
}
