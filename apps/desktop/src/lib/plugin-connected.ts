import { z } from "zod";

export const PLUGIN_CONNECTED_EVENT = "chief:plugin-connected";

/** Cancelled by an open plugin dialog that walks through the plugin itself. */
export function announcePluginConnected(workspaceId: string, pluginId: string) {
  window.dispatchEvent(
    new CustomEvent(PLUGIN_CONNECTED_EVENT, {
      detail: { workspaceId, pluginId },
      cancelable: true,
    }),
  );
}

export const pluginConnectedSchema = z.object({
  workspaceId: z.string(),
  pluginId: z.string(),
});
