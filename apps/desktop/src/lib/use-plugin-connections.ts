import { useEffect, useState } from "react";
import { z } from "zod";

import { useAuth } from "./auth/auth-context";
import { readLocalCache, writeLocalCache } from "./local-cache";
import { useRelaySession } from "./relay-session-context";

/**
 * What a plugin mark needs, and all that is kept between sessions: never a
 * plugin's URL, which can carry a key.
 */
const pluginMarkSchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string().optional(),
});
type PluginMark = z.infer<typeof pluginMarkSchema>;

// One read of the workspace's plugins serves everything on screen, so a
// conversation full of runs and tool calls asks once, not once per row.
let connections: { at: number; read: Promise<PluginMark[]> } | null = null;

/**
 * The workspace's plugins, read at most once a minute. The last list is kept
 * between sessions so plugin marks paint with the rest of a card.
 */
export function usePluginConnections() {
  const { client } = useRelaySession();
  const { cloudOrganizationId } = useAuth();
  const key = `chief:plugin-connections:${cloudOrganizationId}`;
  const [list, setList] = useState(
    () => readLocalCache(key, z.array(pluginMarkSchema)) ?? [],
  );
  useEffect(() => {
    if (!client) return;
    let live = true;
    if (!connections || Date.now() - connections.at > 60_000)
      connections = {
        at: Date.now(),
        read: client.plugins
          .list()
          .then((all) =>
            all.map(({ id, name, domain }) => ({ id, name, domain })),
          ),
      };
    connections.read.then(
      (next) => {
        writeLocalCache(key, next);
        if (live) setList(next);
      },
      () => {
        connections = null;
      },
    );
    return () => {
      live = false;
    };
  }, [client, key]);
  return list;
}

/**
 * The plugin behind an agent's tool call, and the plugin's own name for the
 * tool. Agents call a plugin's tools as `<plugin id>__<tool>`.
 */
export function usePluginTool(toolName: string) {
  const plugins = usePluginConnections();
  const plugin = plugins.find((candidate) =>
    toolName.startsWith(`${candidate.id}__`),
  );
  return plugin
    ? {
        plugin,
        tool: toolName.slice(toolName.indexOf("__") + 2).replace(/_/gu, " "),
      }
    : undefined;
}
