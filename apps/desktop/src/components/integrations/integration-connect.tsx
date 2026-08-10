import { useNavigate } from "react-router";

import { Button } from "@chief/ui/components/button";

import type { SetupIntegration } from "../../lib/integration-setup";
import { integrationSetupChannelPath } from "../../lib/integration-setup";

/**
 * The one way any integration gets connected, wherever it appears. Connect
 * starts one visible, private conversation with Setup.
 */
export function IntegrationConnect({
  integration,
  connected,
  connectedLabel,
}: {
  integration: SetupIntegration;
  connected: boolean;
  connectedLabel?: string;
}) {
  const navigate = useNavigate();
  const storageKey = `chief:integration-setup:${integration.domain}`;

  const start = () => {
    localStorage.setItem(storageKey, "active");
    void navigate(integrationSetupChannelPath(integration));
  };

  return (
    <div className="space-y-3">
      {connected ? (
        <p className="text-muted-foreground text-xs leading-5">
          {`${connectedLabel ?? integration.name} connected.`}
        </p>
      ) : (
        <Button type="button" onClick={start}>
          Connect {integration.name}
        </Button>
      )}
    </div>
  );
}
