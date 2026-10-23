import { relayCellAutomationRunTools } from "./toolkits/automation-runs.js";
import { relayCellBrowserTools } from "./toolkits/browser.js";
import { relayCellChannelTools } from "./toolkits/channels.js";
import { relayCellMediaTools } from "./toolkits/media.js";
import { relayCellPluginTools } from "./toolkits/plugins.js";
import { relayCellProjectTools } from "./toolkits/projects.js";
import { relayCellWorkspaceTools } from "./toolkits/workspace.js";

export const relayCellTools = [
  ...relayCellAutomationRunTools,
  ...relayCellChannelTools,
  ...relayCellWorkspaceTools,
  ...relayCellMediaTools,
  ...relayCellPluginTools,
  ...relayCellProjectTools,
  ...relayCellBrowserTools,
];
