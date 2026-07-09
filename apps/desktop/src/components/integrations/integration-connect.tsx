import { useState } from "react";
import type { DriverType } from "@marketer/agent-runtime/types";
import { Button } from "@marketer/ui/components/button";
import {
  integrationSetupTask,
  type SetupIntegration,
  type SetupResult,
} from "../../lib/integration-setup";
import { IntegrationSetupPanel } from "../chat/integration-setup-panel";

/**
 * The one way any integration gets connected, wherever it appears
 * (onboarding, analytics, future surfaces): a Connect button that hands the
 * work to the setup agent and streams its progress inline. Callers persist
 * the verified result via onResult.
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
