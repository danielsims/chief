import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { McpConnection } from "@chief/relay-contracts";
import { Dialog, DialogContent } from "@chief/ui/components/dialog";

import {
  PLUGIN_CONNECTED_EVENT,
  pluginConnectedSchema,
} from "../../lib/plugin-connected";
import { useRelaySession } from "../../lib/relay-session";
import { preloadPluginAgentAccess } from "./plugin-agent-access";
import { PluginWalkthrough } from "./plugin-detail-dialog";

/** Shared by catalog, onboarding, custom servers, and chat; stays over the current screen. */
export function PluginInstallAccessStep({
  claim = false,
}: {
  /** A screen's own walkthrough takes the event, so the app-wide one stays closed. */
  claim?: boolean;
} = {}) {
  const { client, snapshot } = useRelaySession();
  const [completed, setCompleted] = useState<{
    client: typeof client;
    workspaceId: string;
    connection: McpConnection;
  } | null>(null);
  const connection =
    completed?.client === client && completed.workspaceId === snapshot?.id
      ? completed.connection
      : null;
  useEffect(() => {
    let active = true;
    const connected = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const input = pluginConnectedSchema.safeParse(event.detail);
      if (
        event.defaultPrevented ||
        !input.success ||
        input.data.workspaceId !== snapshot?.id ||
        !client
      )
        return;
      if (claim) event.preventDefault();
      void client.plugins
        .list()
        .then(async (connections) => {
          const found = connections.find(
            (item) =>
              (item.catalogId ?? item.id) === input.data.pluginId &&
              item.status === "connected",
          );
          // A plugin dialog that was already open took over the walkthrough.
          if (!found || (!claim && event.defaultPrevented)) return;
          // Opens with the list in place rather than filling in afterwards.
          await preloadPluginAgentAccess(client, found.id).catch(
            () => undefined,
          );
          if (active)
            setCompleted({
              client,
              workspaceId: input.data.workspaceId,
              connection: found,
            });
        })
        .catch(() => {
          if (active)
            toast.error(
              "Connected. Open the plugin’s details to choose agent access.",
            );
        });
    };
    window.addEventListener(PLUGIN_CONNECTED_EVENT, connected);
    return () => {
      active = false;
      window.removeEventListener(PLUGIN_CONNECTED_EVENT, connected);
    };
  }, [claim, client, snapshot?.id]);
  return (
    <Dialog
      open={Boolean(connection)}
      onOpenChange={(open) => {
        if (!open) setCompleted(null);
      }}
    >
      <DialogContent className="border-border/80 w-[calc(100%-32px)] max-w-[800px] gap-0 overflow-hidden rounded-2xl p-0 shadow-[0_16px_64px_-12px_rgb(0_0_0/0.45)]">
        {connection ? (
          <PluginWalkthrough
            key={connection.id}
            name={connection.name}
            domain={connection.domain ?? new URL(connection.url).hostname}
            description={connection.description}
            status={{ tone: "bg-emerald-500", label: "Connected" }}
            host={new URL(connection.url).hostname}
            tools={connection.tools}
            connectionId={connection.id}
            justConnected
            onDone={() => setCompleted(null)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
