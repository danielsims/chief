import { relayCellBrowserTools } from "./toolkits/browser.js";
import { relayCellChannelTools } from "./toolkits/channels.js";
import { relayCellPluginTools } from "./toolkits/plugins.js";
import { relayCellWorkspaceTools } from "./toolkits/workspace.js";

export const relayCellTools = [
  ...relayCellChannelTools,
  ...relayCellWorkspaceTools,
  ...relayCellPluginTools,
  ...relayCellBrowserTools,
];
