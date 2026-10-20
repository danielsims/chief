import { useCallback, useEffect, useState } from "react";

import type {
  AutomationChiefTool,
  McpConnection,
} from "@chief/relay-contracts";

import { useRelaySession } from "../lib/relay-session-context";

export interface AutomationCatalogue {
  chief: AutomationChiefTool[];
  plugins: McpConnection[];
  loading: boolean;
  error: string;
  reload: () => void;
}

/** Every tool an automation step can use: Chief's own and connected plugins'. */
export function useAutomationCatalogue(): AutomationCatalogue {
  const { client } = useRelaySession();
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((current) => current + 1), []);
  const [state, setState] = useState<Omit<AutomationCatalogue, "reload">>({
    chief: [],
    plugins: [],
    loading: true,
    error: "",
  });
  useEffect(() => {
    if (!client) return;
    let active = true;
    void Promise.all([client.plugins.automationTools(), client.plugins.list()])
      .then(([chief, plugins]) => {
        if (active)
          setState({
            chief,
            plugins: plugins.filter((plugin) => plugin.status === "connected"),
            loading: false,
            error: "",
          });
      })
      .catch((error: unknown) => {
        if (active)
          setState((current) => ({
            ...current,
            loading: false,
            error:
              error instanceof Error && error.message
                ? error.message
                : "Couldn't load the tools. Check your connection and reopen this page.",
          }));
      });
    return () => {
      active = false;
    };
  }, [client, version]);
  return { ...state, reload };
}

/** Chief's tool names read as `channels.messages.post`; show them as people would say them. */
export function chiefToolLabel(
  tool: Pick<AutomationChiefTool, "name" | "title">,
) {
  const title = tool.title?.trim();
  if (title) return title;
  return tool.name;
}

export function chiefToolGroup(name: string) {
  const group = name.split(".")[0] ?? name;
  const labels: Record<string, string> = {
    channels: "Channels",
    files: "Files",
    projects: "Projects",
    prospects: "Prospects",
    brandProfile: "Brand",
    recurringWork: "Automations",
    web: "Web",
  };
  return labels[group] ?? group.charAt(0).toUpperCase() + group.slice(1);
}
