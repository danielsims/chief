import type { LocalTool } from "../tool.js";
import { actionsToolkit } from "./actions/index.js";
import { analyticsToolkit } from "./analytics/index.js";
import { automationToolkit } from "./automation/index.js";
import { browserToolkit } from "./browser/index.js";
import { campaignsToolkit } from "./campaigns/index.js";
import { channelsToolkit } from "./channels/index.js";
import { computerToolkit } from "./computer/index.js";
import { contentToolkit } from "./content/index.js";
import { filesToolkit } from "./files/index.js";
import { integrationsToolkit } from "./integrations/index.js";
import { pluginsToolkit } from "./plugins/index.js";
import { projectsToolkit } from "./projects/index.js";
import { researchToolkit } from "./research/index.js";
import { scheduledWorkToolkit } from "./scheduled-work/index.js";
import { setupToolkit } from "./setup/index.js";
import { specialistsToolkit } from "./specialists/index.js";
import { workspaceToolkit } from "./workspace/index.js";

export const localToolkits = {
  actions: actionsToolkit,
  analytics: analyticsToolkit,
  automation: automationToolkit,
  browser: browserToolkit,
  campaigns: campaignsToolkit,
  channels: channelsToolkit,
  content: contentToolkit,
  computer: computerToolkit,
  files: filesToolkit,
  integrations: integrationsToolkit,
  plugins: pluginsToolkit,
  projects: projectsToolkit,
  research: researchToolkit,
  scheduledWork: scheduledWorkToolkit,
  setup: setupToolkit,
  specialists: specialistsToolkit,
  workspace: workspaceToolkit,
} as const;

export const workspaceTools: readonly LocalTool[] =
  Object.values(localToolkits).flat();
