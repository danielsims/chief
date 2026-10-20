import { useEffect, useState } from "react";

import type { RelayClient } from "@chief/relay-client";
import type { McpConnection } from "@chief/relay-contracts";
import { Switch } from "@chief/ui/components/switch";

import { ProviderLogo } from "../provider-logo";
import {
  SectionHeading,
  SettingGroup,
  SettingRow,
} from "./agent-detail-sections";

/**
 * Which workspace plugins this agent may use. The relay enforces the list on
 * every call, so turning one off takes effect on the agent's next tool call.
 */
export function AgentPluginAccess({
  client,
  assigned,
  asksBeforeActing,
  ready,
  onChange,
}: {
  client: RelayClient | null | undefined;
  assigned: readonly string[];
  asksBeforeActing: boolean;
  ready: boolean;
  onChange: (integrations: string[]) => void;
}) {
  const [connections, setConnections] = useState<McpConnection[] | null>(null);
  useEffect(() => {
    let active = true;
    if (client)
      void client.plugins
        .list()
        .then((next) => {
          if (active) setConnections(next);
        })
        .catch(() => {
          if (active) setConnections([]);
        });
    return () => {
      active = false;
    };
  }, [client]);
  const connected = (connections ?? []).filter(
    (connection) => connection.status === "connected",
  );
  if (!client || connected.length === 0) return null;

  return (
    <section className="mt-8">
      <SectionHeading
        title="Plugins"
        description={
          asksBeforeActing
            ? "This agent asks before acting, so it can only use tools that read."
            : "Choose which connected plugins this agent can use."
        }
      />
      <SettingGroup>
        {connected.map((connection) => {
          const writes = connection.tools.filter(
            (tool) => !tool.readOnly,
          ).length;
          const reads = connection.tools.length - writes;
          return (
            <SettingRow
              key={connection.id}
              title={
                <span className="flex items-center gap-2.5">
                  <ProviderLogo
                    domain={
                      connection.domain ?? new URL(connection.url).hostname
                    }
                    label={connection.name}
                    className="size-5 rounded-md"
                  />
                  {connection.name}
                </span>
              }
              description={`${reads} read, ${writes} write ${connection.tools.length === 1 ? "tool" : "tools"}`}
              control={
                <Switch
                  checked={assigned.includes(connection.id)}
                  disabled={!ready}
                  onCheckedChange={(next) =>
                    onChange(
                      next
                        ? [...new Set([...assigned, connection.id])]
                        : assigned.filter((id) => id !== connection.id),
                    )
                  }
                />
              }
            />
          );
        })}
      </SettingGroup>
    </section>
  );
}
