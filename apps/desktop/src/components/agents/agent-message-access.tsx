import { useEffect, useState } from "react";

import type { RelayClient } from "@chief/relay-client";
import type { AgentConfig } from "@chief/relay-contracts";
import { Switch } from "@chief/ui/components/switch";

export function AgentMessageAccess({
  agentId,
  client,
}: {
  agentId: string;
  client?: RelayClient | null;
}) {
  const [loaded, setLoaded] = useState<{
    agentId: string;
    config: AgentConfig;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (client)
      void client
        .loadAgentConfig(agentId)
        .then(({ config }) => {
          if (!cancelled) setLoaded({ agentId, config });
        })
        .catch(() => {
          if (!cancelled) setError("Could not load messaging access.");
        });
    return () => {
      cancelled = true;
    };
  }, [agentId, client]);
  const config = loaded?.agentId === agentId ? loaded.config : null;
  if (config?.deploymentTarget === "cloud") return null;
  return (
    <div className="mb-6 border-b pb-5">
      <div className="flex items-center justify-between gap-6">
        <div>
          <p className="text-sm font-medium">Allow workspace messages</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Let other members and their agents message this personal agent.
          </p>
        </div>
        <Switch
          aria-label="Allow workspace messages"
          disabled={!config || !client || saving}
          checked={config?.messageAccess === "workspace"}
          onCheckedChange={(shared) => {
            if (!client) return;
            setSaving(true);
            setError(null);
            void client
              .loadAgentConfig(agentId)
              .then(async ({ config: current }) => {
                const next = {
                  ...current,
                  messageAccess: shared
                    ? ("workspace" as const)
                    : ("owner" as const),
                };
                await client.saveAgentConfig(agentId, next);
                setLoaded({ agentId, config: next });
              })
              .catch(() => setError("Could not save messaging access."))
              .finally(() => setSaving(false));
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
