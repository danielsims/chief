import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import { SuccessCheck } from "@chief/ui/components/success-check";
import { cn } from "@chief/ui/lib/utils";

import type { IntegrationSearchResult } from "../lib/integrations";
import { IntegrationChoiceCard } from "../components/integrations/integration-choice-card";
import { StepFrame } from "../components/onboarding/onboarding-step-frame";
import {
  cachedIntegrationSearch,
  searchIntegrations,
} from "../lib/integrations";
import { onboardingCompletionPresentation } from "../lib/onboarding-completion";
import { integrationDomainKey } from "./onboarding-options";

export function IntegrationPickerControl({
  selected,
  setSelected,
  fallbackIntegrations,
  defaultSearchQuery,
  searchPlaceholder,
  onContinue,
  saving,
}: {
  selected: IntegrationSearchResult[];
  setSelected: (integrations: IntegrationSearchResult[]) => void;
  fallbackIntegrations: IntegrationSearchResult[];
  defaultSearchQuery: string;
  searchPlaceholder: string;
  onContinue: () => void;
  saving: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IntegrationSearchResult[]>(
    () => cachedIntegrationSearch(defaultSearchQuery) ?? fallbackIntegrations,
  );
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [canScrollDown, setCanScrollDown] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const trimmed = query.trim();
    if (!trimmed) return;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setResults([]);
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
    const candidates = query.trim()
      ? [...results, ...selected]
      : [...fallbackIntegrations, ...selected];
    return candidates.filter((integration) => {
      const key = integrationDomainKey(integration.domain);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [fallbackIntegrations, query, results, selected]);

  const updateScrollCue = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    setCanScrollDown(
      list.scrollHeight - list.scrollTop - list.clientHeight > 2,
    );
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateScrollCue);
    return () => window.cancelAnimationFrame(frame);
  }, [options.length, updateScrollCue]);

  const toggle = (integration: IntegrationSearchResult) => {
    const domainKey = integrationDomainKey(integration.domain);
    const exists = selected.some(
      (item) => integrationDomainKey(item.domain) === domainKey,
    );
    setSelected(
      exists
        ? selected.filter(
            (item) => integrationDomainKey(item.domain) !== domainKey,
          )
        : [...selected, integration],
    );
  };

  return (
    <StepFrame
      onContinue={onContinue}
      saving={saving}
      continueLabel="Continue"
      actionsAlign="right"
      separateActions={false}
      className="bg-[color-mix(in_srgb,var(--card)_60%,var(--background))]"
    >
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={searchPlaceholder}
      />
      <div className="relative mt-3">
        <div
          ref={listRef}
          onScroll={updateScrollCue}
          className={cn(
            "grid max-h-[368px] gap-2 overflow-y-auto pr-1 pb-16 transition-opacity sm:grid-cols-3",
            loading && "opacity-70",
          )}
        >
          {options.map((integration) => (
            <IntegrationChoiceCard
              key={integrationDomainKey(integration.domain)}
              integration={integration}
              selected={selected.some(
                (item) =>
                  integrationDomainKey(item.domain) ===
                  integrationDomainKey(integration.domain),
              )}
              onClick={() => toggle(integration)}
              compact
            />
          ))}
        </div>
        {canScrollDown ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute right-1 bottom-0 left-0 h-20 bg-gradient-to-b from-transparent to-[color-mix(in_srgb,var(--card)_60%,var(--background))]"
          />
        ) : null}
      </div>
    </StepFrame>
  );
}

export function CompletionControl({
  onContinue,
  runtimeReady,
  saving,
}: {
  onContinue: () => void;
  runtimeReady: boolean;
  saving: boolean;
}) {
  const presentation = onboardingCompletionPresentation({
    runtimeReady,
    saving,
  });
  return (
    <div className="bg-card flex min-h-[480px] w-full items-center justify-center rounded-xl border px-6 py-14">
      <div className="flex max-w-sm flex-col items-center text-center">
        <SuccessCheck className="mb-8" />
        <div className="success-copy flex flex-col items-center">
          <h2 className="text-4xl leading-none font-normal tracking-[-0.04em]">
            You're in.
          </h2>
          <p className="text-muted-foreground mt-4 text-sm leading-6">
            {presentation.description}
          </p>
          <Button
            type="button"
            className="mt-9"
            onClick={onContinue}
            disabled={presentation.buttonDisabled}
          >
            {presentation.buttonLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
