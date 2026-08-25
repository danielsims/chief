import { hostedBrowserTools } from "./toolkits/browser";
import { hostedChannelTools } from "./toolkits/channels";
import { hostedComputerTools } from "./toolkits/computer";
import { hostedPluginTools } from "./toolkits/plugins";
import { hostedWorkspaceTools } from "./toolkits/workspace";

export const hostedAgentTools = [
  ...hostedComputerTools,
  ...hostedChannelTools,
  ...hostedPluginTools,
  ...hostedWorkspaceTools,
  ...hostedBrowserTools,
];
