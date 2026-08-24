import type { Dispatch, SetStateAction } from "react";

import type { IntegrationSearchResult } from "../lib/integrations";
import type { OnboardingDraft } from "../lib/onboarding-draft";
import type { RuntimeStatus } from "../lib/runtime";
import type { SocialPlatform } from "../lib/social-platforms";
import type { StepKey } from "./onboarding-options";
import {
  AutomationControl,
  MonitoringControl,
} from "./onboarding-automation-controls";
import {
  CompletionControl,
  IntegrationPickerControl,
} from "./onboarding-integration-controls";
import {
  AudienceControl,
  HealthControl,
  SellingControl,
  SuccessControl,
  TimeControl,
} from "./onboarding-strategy-controls";
import {
  BrandControl,
  ContextControl,
  ModeControl,
  ProviderControl,
  SocialsControl,
} from "./onboarding-workspace-controls";

interface OnboardingCurrentControlProps {
  advance: () => Promise<void>;
  cloudOrganizationId: string | null;
  completeOnboarding: () => Promise<void>;
  draft: OnboardingDraft;
  everydayIntegrations: IntegrationSearchResult[];
  runtimeStatus: RuntimeStatus;
  saving: boolean;
  setAutomation: (patch: Partial<OnboardingDraft["automation"]>) => void;
  setBrand: (patch: Partial<OnboardingDraft["brand"]>) => void;
  setDraft: Dispatch<SetStateAction<OnboardingDraft | null>>;
  setField: (patch: Partial<OnboardingDraft>) => void;
  setGoals: (patch: Partial<OnboardingDraft["goals"]>) => void;
  setMonitoring: (patch: Partial<OnboardingDraft["monitoring"]>) => void;
  setPluginIntegrations: (integrations: IntegrationSearchResult[]) => void;
  setSocial: (platform: SocialPlatform, handle: string) => void;
  step: StepKey;
  workspaceReady: boolean;
}

export function OnboardingCurrentControl({
  advance,
  cloudOrganizationId,
  completeOnboarding,
  draft,
  everydayIntegrations,
  runtimeStatus,
  saving,
  setAutomation,
  setBrand,
  setDraft,
  setField,
  setGoals,
  setMonitoring,
  setPluginIntegrations,
  setSocial,
  step,
  workspaceReady,
}: OnboardingCurrentControlProps) {
  if (step === "mode") {
    return <ModeControl onContinue={advance} saving={saving} />;
  }
  if (step === "inference") {
    return (
      <ProviderControl
        draft={draft}
        setField={setField}
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
    return (
      <HealthControl
        draft={draft}
        runtimeStatus={runtimeStatus}
        accountReady={Boolean(cloudOrganizationId)}
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
        ready
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
  if (step === "plugins") {
    return (
      <IntegrationPickerControl
        selected={draft.plugins.integrations}
        setSelected={setPluginIntegrations}
        fallbackIntegrations={everydayIntegrations}
        defaultSearchQuery="business tools"
        searchPlaceholder="Search apps"
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
      runtimeReady={workspaceReady}
      saving={saving}
    />
  );
}
