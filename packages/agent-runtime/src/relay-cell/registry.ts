import { relayCellAutomationBuildTools } from "./toolkits/automation-build.js";
import { relayCellAutomationRunTools } from "./toolkits/automation-runs.js";
import { relayCellBrowserTools } from "./toolkits/browser.js";
import { relayCellChannelTools } from "./toolkits/channels.js";
import { relayCellDatabaseTools } from "./toolkits/databases.js";
import { relayCellDraftTools } from "./toolkits/drafts.js";
import { relayCellMediaTools } from "./toolkits/media.js";
import { relayCellPluginTools } from "./toolkits/plugins.js";
import { relayCellProjectTools } from "./toolkits/projects.js";
import { relayCellWebTools } from "./toolkits/web.js";
import { relayCellWorkspaceTools } from "./toolkits/workspace.js";

export const relayCellTools = [
  ...relayCellAutomationRunTools,
  ...relayCellAutomationBuildTools,
  ...relayCellChannelTools,
  ...relayCellDatabaseTools,
  ...relayCellDraftTools,
  ...relayCellWorkspaceTools,
  ...relayCellMediaTools,
  ...relayCellPluginTools,
  ...relayCellProjectTools,
  ...relayCellBrowserTools,
  ...relayCellWebTools,
];
