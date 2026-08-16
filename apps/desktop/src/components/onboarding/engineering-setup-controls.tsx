import type { IntegrationSearchResult } from "../../lib/integrations";
import { ENGINEERING_INTEGRATIONS } from "../../lib/integration-catalog";
import { IntegrationChoiceCard } from "../integrations/integration-choice-card";
import { Chip, StepFrame } from "./onboarding-step-frame";

export function EngineeringAccessControl({
  selected,
  setSelected,
  onContinue,
  saving,
}: {
  selected: boolean | null;
  setSelected: (enabled: boolean) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  return (
    <StepFrame
      onContinue={onContinue}
      saving={saving}
      disabled={selected === null}
    >
      <p className="text-muted-foreground text-sm leading-6">
        Chief can connect your code, deployment, or website platform to install
        marketing integrations and prepare reviewable changes. It will not
        merge, publish, or deploy anything without your approval.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Chip selected={selected === true} onClick={() => setSelected(true)}>
          Yes, allow code changes
        </Chip>
        <Chip selected={selected === false} onClick={() => setSelected(false)}>
          Not right now
        </Chip>
      </div>
    </StepFrame>
  );
}

export function EngineeringToolsControl({
  selected,
  setSelected,
  onContinue,
  saving,
}: {
  selected: IntegrationSearchResult[];
  setSelected: (integrations: IntegrationSearchResult[]) => void;
  onContinue: () => void;
  saving: boolean;
}) {
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
      disabled={selected.length === 0}
    >
      <p className="text-muted-foreground mb-4 text-sm leading-6">
        Select the code, deployment, and website platforms Chief should connect.
        You can add or remove connections later from Plugins.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {ENGINEERING_INTEGRATIONS.map((integration) => (
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
