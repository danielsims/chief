import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";

import type { OnboardingSchedule } from "@chief/agent-runtime/types";
import { parseJsonObject, toJsonObject } from "@chief/relay-contracts";

import type { AuthOrganization } from "../lib/auth/better-auth-contracts";
import type { OnboardingDraft } from "../lib/onboarding-draft";
import type { StepKey } from "./onboarding-options";
import { resolveFaviconUrl } from "../components/org-logo";
import { setWorkspaceProvider } from "../lib/agent-overrides";
import { useAuth } from "../lib/auth/auth-context";
import {
  createAuthOrganization,
  listAuthOrganizations,
  setActiveAuthOrganization,
  updateAuthOrganization,
} from "../lib/auth/better-auth-client";
import { parseOrganizationMetadata } from "../lib/auth/better-auth-contracts";
import { searchIntegrations } from "../lib/integrations";
import { primeLocalIntegrationStatus } from "../lib/local-integration-status-cache";
import {
  loadOnboardingDraft,
  loadPendingOnboardingDraft,
  onboardingStorageKey,
  onboardingWorkspaceSlug,
  pendingOnboardingStorageKey,
} from "../lib/onboarding-draft";
import { isOnboardingStep, nextOnboardingStep } from "../lib/onboarding-flow";
import { buildOnboardingWorkJobs } from "../lib/onboarding-work";
import { onboardingPluginOptions } from "../lib/plugin-presentation";
import {
  updatePendingOnboardingDriver,
  useAgentPreferences,
  useRuntime,
  useWorkspaceData,
} from "../lib/runtime";
import { usePlugins } from "../lib/runtime-plugins";
import { workspaceContextFromOrganization } from "../lib/workspace-context";
import { OnboardingConversation } from "./onboarding-conversation";
import { OnboardingCurrentControl } from "./onboarding-current-control";
import {
  fallbackEverydayIntegrations,
  integrationDomainKey,
  pluginIntegration,
  preferredEverydayIntegrations,
  steps,
} from "./onboarding-options";
import { useOnboardingDraft } from "./use-onboarding-draft";

export function OnboardingPage() {
  const navigate = useNavigate();
  const { cloudOrganizationId, user, signOut } = useAuth();
  const { status: runtimeStatus } = useRuntime();
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const plugins = usePlugins();
  const everydayIntegrations = useMemo(() => {
    const catalog = onboardingPluginOptions(plugins.plugins ?? [], 60).map(
      pluginIntegration,
    );
    const catalogByDomain = new Map(
      catalog.map((integration) => [
        integrationDomainKey(integration.domain),
        integration,
      ]),
    );
    const candidates = [
      ...preferredEverydayIntegrations.map((preferred) => ({
        ...(catalogByDomain.get(integrationDomainKey(preferred.domain)) ??
          preferred),
        name: preferred.name,
      })),
      ...catalog,
      ...fallbackEverydayIntegrations,
    ];
    const seen = new Set<string>();
    return candidates
      .filter((integration) => {
        const key = integrationDomainKey(integration.domain);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 30);
  }, [plugins.plugins]);
  const agentPreferences = useAgentPreferences(cloudOrganizationId);
  const [org, setOrg] = useState<AuthOrganization | null>(null);
  const {
    draft,
    setAutomation,
    setBrand,
    setDraft,
    setField,
    setGoals,
    setMonitoring,
    setPluginIntegrations,
    setSocial,
  } = useOnboardingDraft();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingStep, setEditingStep] = useState<StepKey | null>(null);
  const currentQuestionRef = useRef<HTMLDivElement | null>(null);
  const completionStartedRef = useRef(false);
  // Deep links may reopen any current onboarding step.
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
        ? loadOnboardingDraft(active, user?.name)
        : loadPendingOnboardingDraft();
      const requestedStep = searchParams.get("step");
      if (requestedStep && isOnboardingStep(requestedStep)) {
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
  }, [
    cloudOrganizationId,
    searchParams,
    setDraft,
    setSearchParams,
    user?.name,
  ]);

  useEffect(() => {
    void searchIntegrations("business tools");
  }, []);

  useEffect(() => {
    if (!draft) return;
    localStorage.setItem(
      org ? onboardingStorageKey(org.id) : pendingOnboardingStorageKey(),
      JSON.stringify(draft),
    );
  }, [draft, org]);

  const latestStep = draft?.step ?? "mode";
  const step = editingStep ?? latestStep;
  const currentIndex = steps.indexOf(latestStep);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      currentQuestionRef.current?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  const goNext = useCallback(() => {
    setNotice(null);
    setError(null);
    setDraft((current) => {
      if (!current) return current;
      const next = nextOnboardingStep(current.step);
      return { ...current, step: next };
    });
  }, [setDraft]);

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
      slug: onboardingWorkspaceSlug("chief-workspace"),
    });
    const metadata = parseOrganizationMetadata(created);
    const onboarding = parseJsonObject(metadata.onboarding) ?? {};
    await updateAuthOrganization(created.id, {
      metadata: {
        ...metadata,
        onboarding: { ...onboarding, provisional: true },
      },
    });
    await setActiveAuthOrganization(created.id);
    const nextDraft = { ...draft, step: "inference" as const };
    localStorage.setItem(
      onboardingStorageKey(created.id),
      JSON.stringify(nextDraft),
    );
    localStorage.removeItem(pendingOnboardingStorageKey());
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
  }, [draft, org, setDraft]);

  const persistContext = useCallback(async () => {
    if (!draft) return false;
    const logo = (await resolveFaviconUrl(draft.websiteUrl)) ?? undefined;
    if (!org) {
      const name = draft.companyName.trim();
      if (!name) return false;
      const created = await createAuthOrganization({
        name,
        slug: onboardingWorkspaceSlug(name),
        logo,
      });
      const metadata = parseOrganizationMetadata(created);
      const nextDraft: OnboardingDraft = { ...draft, step: "inference" };
      await updateAuthOrganization(created.id, {
        metadata: { ...metadata, websiteUrl: draft.websiteUrl.trim() },
      });
      await setActiveAuthOrganization(created.id);
      localStorage.setItem(
        onboardingStorageKey(created.id),
        JSON.stringify(nextDraft),
      );
      localStorage.removeItem(pendingOnboardingStorageKey());
      window.location.assign("/onboarding");
      return true;
    }
    const metadata = parseOrganizationMetadata(org);
    const onboarding = parseJsonObject(metadata.onboarding) ?? {};
    delete onboarding.provisional;
    await updateAuthOrganization(org.id, {
      name: draft.companyName.trim() || org.name,
      logo: org.logo ?? logo,
      metadata: toJsonObject({
        ...metadata,
        websiteUrl: draft.websiteUrl.trim(),
        onboarding,
      }),
    });
    setOrg({
      ...org,
      name: draft.companyName.trim() || org.name,
      logo: org.logo ?? logo,
      metadata: toJsonObject({
        ...metadata,
        websiteUrl: draft.websiteUrl.trim(),
        onboarding,
      }),
    });
    return false;
  }, [draft, org]);

  const persistSocials = useCallback(async () => {
    if (!draft || !org) return;
    const metadata = parseOrganizationMetadata(org);
    await updateAuthOrganization(org.id, {
      metadata: toJsonObject({ ...metadata, socialAccounts: draft.socials }),
    });
  }, [draft, org]);

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

  const completeOnboarding = useCallback(async () => {
    if (!org || !draft || completionStartedRef.current) return;
    completionStartedRef.current = true;
    setSaving(true);
    setError(null);
    sessionStorage.setItem(`chief:onboarding:${org.id}`, String(Date.now()));
    try {
      await persistContext();
      await persistSocials();
      persistProvider();
      const metadata = parseOrganizationMetadata(org);
      const persistedOnboarding = parseJsonObject(metadata.onboarding) ?? {};
      delete persistedOnboarding.provisional;
      const deferredAutomation = {
        ...draft.automation,
        mode: "manual" as const,
        plan: draft.automation.plan.map((item) => ({
          ...item,
          enabled: false,
        })),
      };
      const kickoffMetadata = {
        ...metadata,
        websiteUrl: draft.websiteUrl.trim(),
        onboarding: {
          ...persistedOnboarding,
          provider: draft.provider,
          model: draft.model || null,
          providerMode: draft.providerMode,
          brand: {
            mode: draft.brand.mode,
            notes: draft.brand.notes,
            files: draft.brand.files.map(({ name, type }) => ({ name, type })),
          },
          goals: draft.goals,
          monitoring: draft.monitoring,
          plugins: draft.plugins,
          analytics: draft.analytics,
          ads: draft.ads,
          aeo: draft.aeo,
          engineering: draft.engineering,
          automation: deferredAutomation,
        },
      };
      const jobs = buildOnboardingWorkJobs({
        workspaceId: org.id,
        companyName: draft.companyName,
        websiteUrl: draft.websiteUrl,
        timezone: draft.automation.timezone,
        brand: draft.brand,
        plugins: draft.plugins,
      });
      const schedules: OnboardingSchedule[] = [];
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
            metadata: toJsonObject(completedMetadata),
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
      localStorage.removeItem(onboardingStorageKey(org.id));
      window.dispatchEvent(new Event("chief:onboarding-complete"));
      void navigate("/", { replace: true });
      if (onboardingRun) {
        void onboardingRun.catch((onboardingError: Error) => {
          console.warn(
            "[Onboarding] Mission control onboarding will retry in the background",
            onboardingError,
          );
        });
      }
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
      if (step === "inference") persistProvider();
      if (step === "finish") {
        await completeOnboarding();
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
    finishCurrentStep,
    persistContext,
    prepareWorkspace,
    persistProvider,
    persistSocials,
    saving,
    step,
  ]);

  if (loading) {
    return (
      <div className="bg-background text-muted-foreground flex min-h-screen items-center justify-center text-sm">
        Loading workspace...
      </div>
    );
  }

  if (!draft) return <Navigate to="/workspaces/new" replace />;

  const currentControl = (
    <OnboardingCurrentControl
      advance={advance}
      cloudOrganizationId={cloudOrganizationId}
      completeOnboarding={completeOnboarding}
      draft={draft}
      everydayIntegrations={everydayIntegrations}
      runtimeStatus={runtimeStatus}
      saving={saving}
      setAutomation={setAutomation}
      setBrand={setBrand}
      setDraft={setDraft}
      setField={setField}
      setGoals={setGoals}
      setMonitoring={setMonitoring}
      setPluginIntegrations={setPluginIntegrations}
      setSocial={setSocial}
      step={step}
      workspaceReady={workspaceData.onboardingBootstrapReady}
    />
  );

  return (
    <OnboardingConversation
      control={currentControl}
      currentIndex={currentIndex}
      currentQuestionRef={currentQuestionRef}
      draft={draft}
      editingStep={editingStep}
      error={error}
      notice={notice}
      onCancelEditing={() => setEditingStep(null)}
      onEdit={(pastStep) => {
        setNotice(null);
        setError(null);
        setEditingStep(pastStep);
      }}
      onSignOut={signOut}
      step={step}
      user={user}
    />
  );
}
