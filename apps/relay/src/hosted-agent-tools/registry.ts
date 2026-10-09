import { hostedBrowserTools } from "./toolkits/browser";
import { hostedChannelTools } from "./toolkits/channels";
import { hostedComputerTools } from "./toolkits/computer";
import { hostedMissionTools } from "./toolkits/missions";
import { hostedPluginTools } from "./toolkits/plugins";
import { hostedProjectTools } from "./toolkits/projects";
import { hostedQuestionTools } from "./toolkits/questions";
import { hostedSpecialistTools } from "./toolkits/specialists";
import { hostedWebTools } from "./toolkits/web";
import { hostedWorkspaceTools } from "./toolkits/workspace";

export const hostedAgentTools = [
  ...hostedMissionTools,
  ...hostedComputerTools,
  ...hostedChannelTools,
  ...hostedPluginTools,
  ...hostedProjectTools,
  ...hostedQuestionTools,
  ...hostedSpecialistTools,
  ...hostedWorkspaceTools,
  ...hostedWebTools,
  ...hostedBrowserTools,
];
