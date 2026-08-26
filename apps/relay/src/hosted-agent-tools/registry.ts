import { hostedBrowserTools } from "./toolkits/browser";
import { hostedChannelTools } from "./toolkits/channels";
import { hostedComputerTools } from "./toolkits/computer";
import { hostedPluginTools } from "./toolkits/plugins";
import { hostedSpecialistTools } from "./toolkits/specialists";
import { hostedWorkspaceTools } from "./toolkits/workspace";

export const hostedAgentTools = [
  ...hostedComputerTools,
  ...hostedChannelTools,
  ...hostedPluginTools,
  ...hostedSpecialistTools,
  ...hostedWorkspaceTools,
  ...hostedBrowserTools,
];
