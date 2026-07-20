import { useState } from "react";

import { Button } from "@chief/ui/components/button";

import type {
  SetupIntegration,
  SetupResult,
} from "../../lib/integration-setup";
import { integrationSetupTask } from "../../lib/integration-setup";
import { IntegrationSetupPanel } from "../chat/integration-setup-panel";

/**
 * The one way any integration gets connected, wherever it appears. Connect
 * starts one visible Setup agent directly with full authority for that run;
 * it never routes through the CMO or an Overview action.
 */
export function IntegrationConnect({
  integration,
  connected,
  connectedLabel,
  onResult,
}: {
  integration: SetupIntegration;
  connected: boolean;
  connectedLabel?: string;
  onResult: (result: SetupResult) => void;
}) {
  const storageKey = `chief:integration-setup:${integration.domain}`;
  const [started, setStarted] = useState(
    () => localStorage.getItem(storageKey) === "active",
  );

  const start = () => {
    localStorage.setItem(storageKey, "active");
    setStarted(true);
  };

  return (
    <div className="space-y-3">
      {connected ? (
        <p className="text-muted-foreground text-xs leading-5">
          {`${connectedLabel ?? integration.name} connected.`}
        </p>
      ) : started ? (
        <IntegrationSetupPanel
          sessionKey={integration.domain}
          prompt={integrationSetupTask(integration)}
          onResult={(result) => {
            localStorage.removeItem(storageKey);
            setStarted(false);
            onResult(result);
          }}
        />
      ) : (
        <Button type="button" onClick={start}>
          Connect {integration.name}
        </Button>
      )}
    </div>
  );
}
