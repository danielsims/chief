import { useEffect, useState } from "react";

import type { McpConnection } from "@chief/relay-contracts";

import { useRelaySession } from "./relay-session-context";

// One read of the workspace's plugins serves everything on screen, so a
// conversation full of runs and tool calls asks once, not once per row.
let connections: { at: number; read: Promise<McpConnection[]> } | null = null;

/** The workspace's plugins, read at most once a minute. */
export function usePluginConnections() {
  const { client } = useRelaySession();
  const [list, setList] = useState<McpConnection[]>([]);
  useEffect(() => {
    if (!client) return;
    let live = true;
    if (!connections || Date.now() - connections.at > 60_000)
      connections = { at: Date.now(), read: client.plugins.list() };
    connections.read.then(
      (next) => {
        if (live) setList(next);
      },
      () => {
        connections = null;
      },
    );
    return () => {
      live = false;
    };
  }, [client]);
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
