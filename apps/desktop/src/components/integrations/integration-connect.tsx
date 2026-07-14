import { useMemo, useState } from "react";
import type { DriverType } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import {
  integrationSetupTask,
  preConnectRequirement,
  requirementEnvKeys,
  type SetupIntegration,
  type SetupResult,
} from "../../lib/integration-setup";
import { useStoredInputs } from "../../lib/runtime";
import { IntegrationSetupPanel } from "../chat/integration-setup-panel";
import { InputRequestSection } from "./input-request-section";

/**
 * The one way any integration gets connected, wherever it appears
 * (onboarding, analytics, future surfaces). Integrations with known
 * credential requirements (the Google family) collect them FIRST with a
 * plain form; the agent only starts once the values exist, so it never runs
 * into a wall Google has already documented. Then a Connect button hands the
 * work to the setup agent and streams its progress inline.
 */
export function IntegrationConnect({
  integration,
  driver,
  connected,
  connectedLabel,
  onResult,
}: {
  integration: SetupIntegration;
  driver: DriverType;
  connected: boolean;
  /** Shown once connected; defaults to the integration name. */
  connectedLabel?: string;
  onResult: (result: SetupResult) => void;
}) {
  const [started, setStarted] = useState(false);

  const requirement = useMemo(
    () => preConnectRequirement(integration.domain),
    [integration.domain],
  );
  const requiredKeys = useMemo(
    () => (requirement ? requirementEnvKeys(requirement) : null),
    [requirement],
  );
  const { present, store } = useStoredInputs(connected ? null : requiredKeys);

  const missingFields =
    requirement && present
      ? requirement.fields.filter(
          (field) => "envKey" in field.save && !present.has(field.save.envKey),
        )
      : [];

  if (!connected && requirement) {
    // Until the runtime has answered, don't flash the wrong state.
    if (present === null) {
      return (
        <p className="animate-pulse text-xs text-muted-foreground">
          Checking what this needs...
        </p>
      );
    }
    if (missingFields.length > 0 && !started) {
      return (
        <InputRequestSection
          request={{ ...requirement, fields: missingFields }}
          onSubmit={(request, values) => store(request, values)}
        />
      );
    }
  }

  return (
    <div className="space-y-3">
      {connected ? (
        <p className="text-xs leading-5 text-muted-foreground">
          {`${connectedLabel ?? integration.name} connected.`}
        </p>
      ) : null}
      {started ? (
        <IntegrationSetupPanel
          domain={integration.domain}
          prompt={integrationSetupTask(integration)}
          driver={driver}
          onResult={onResult}
        />
      ) : !connected ? (
        <Button type="button" onClick={() => setStarted(true)}>
          Connect {integration.name}
        </Button>
      ) : null}
    </div>
  );
}
