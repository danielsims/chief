import { relayCellBrowserTools } from "./toolkits/browser.js";
import { relayCellChannelTools } from "./toolkits/channels.js";
import { relayCellMissionTools } from "./toolkits/missions.js";
import { relayCellPluginTools } from "./toolkits/plugins.js";
import { relayCellProjectTools } from "./toolkits/projects.js";
import { relayCellWorkspaceTools } from "./toolkits/workspace.js";

export const relayCellTools = [
  ...relayCellMissionTools,
  ...relayCellChannelTools,
  ...relayCellWorkspaceTools,
  ...relayCellPluginTools,
  ...relayCellProjectTools,
  ...relayCellBrowserTools,
];
