import { useEffect } from "react";
import { z } from "zod";

import { usePlugins } from "../../lib/runtime-plugins";
import { usePluginConnectFlow } from "./plugin-connect-flow";

const OPEN_PLUGIN_EVENT = "chief:open-plugin";
const openPluginSchema = z.object({ pluginId: z.string() });

/** Opens a plugin's dialog over whatever screen is showing, without navigating. */
export function openPluginDialog(pluginId: string) {
  window.dispatchEvent(
    new CustomEvent(OPEN_PLUGIN_EVENT, { detail: { pluginId } }),
  );
}

/** One plugin dialog for the whole app, for plugins shown outside the Plugins page. */
export function PluginDialogHost() {
  const plugins = usePlugins();
  const flow = usePluginConnectFlow(plugins);
  const { open } = flow;
  useEffect(() => {
    const opened = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const input = openPluginSchema.safeParse(event.detail);
      if (input.success) open(input.data.pluginId);
    };
    window.addEventListener(OPEN_PLUGIN_EVENT, opened);
    return () => window.removeEventListener(OPEN_PLUGIN_EVENT, opened);
  }, [open]);
  return flow.dialogs;
}
