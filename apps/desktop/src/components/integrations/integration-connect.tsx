import { useState } from "react";

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
 * to Chief, who consults the setup specialist and streams progress inline. If
 * user input becomes unavoidable, Chief emits one structured request after
 * finished every machine-only preparation step.
 */
export function IntegrationConnect({
  integration,
  connected,
  connectedLabel,
  onResult,
}: {
  integration: SetupIntegration;
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
          prompt={integrationSetupTask(integration)}
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
