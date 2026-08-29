import { useCallback, useState } from "react";

import type { IntegrationSearchResult } from "../lib/integrations";
import type { OnboardingDraft } from "../lib/onboarding-draft";
import type { SocialPlatform } from "../lib/social-platforms";

export function useOnboardingDraft() {
  const [draft, setDraft] = useState<OnboardingDraft | null>(null);

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

  const setPluginIntegrations = useCallback(
    (integrations: IntegrationSearchResult[]) => {
      setDraft((current) =>
        current ? { ...current, plugins: { integrations } } : current,
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

  return {
    draft,
    setAutomation,
    setBrand,
    setDraft,
    setField,
    setGoals,
    setMonitoring,
    setPluginIntegrations,
    setSocial,
  };
}
