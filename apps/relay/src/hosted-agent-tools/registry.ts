import { hostedBrowserTools } from "./toolkits/browser";
import { hostedChannelTools } from "./toolkits/channels";
import { hostedComputerTools } from "./toolkits/computer";
import { hostedMissionTools } from "./toolkits/missions";
import { hostedPluginTools } from "./toolkits/plugins";
import { hostedProjectTools } from "./toolkits/projects";
import { hostedSpecialistTools } from "./toolkits/specialists";
import { hostedWebTools } from "./toolkits/web";
import { hostedWorkspaceTools } from "./toolkits/workspace";

export const hostedAgentTools = [
  ...hostedMissionTools,
  ...hostedComputerTools,
  ...hostedChannelTools,
  ...hostedPluginTools,
  ...hostedProjectTools,
  ...hostedSpecialistTools,
  ...hostedWorkspaceTools,
  ...hostedWebTools,
  ...hostedBrowserTools,
];
