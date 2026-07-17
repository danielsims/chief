import { useState } from "react";

import type { DriverType } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";

import type {
  SetupIntegration,
  SetupResult,
} from "../../lib/integration-setup";
import { integrationSetupTask } from "../../lib/integration-setup";
import { IntegrationSetupPanel } from "../chat/integration-setup-panel";

/**
 * The one way any integration gets connected, wherever it appears
 * (onboarding, analytics, future surfaces). A Connect button hands the work
 * to the setup agent and streams its progress inline. If user input becomes
 * unavoidable, the agent emits one structured request only after it has
 * finished every machine-only preparation step.
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

  return (
    <div className="space-y-3">
      {connected ? (
        <p className="text-muted-foreground text-xs leading-5">
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
