import { hostedAutomationTools } from "./toolkits/automations";
import { hostedBoardTools } from "./toolkits/board";
import { hostedBrowserTools } from "./toolkits/browser";
import { hostedChannelTools } from "./toolkits/channels";
import { hostedComputerTools } from "./toolkits/computer";
import { hostedPluginTools } from "./toolkits/plugins";
import { hostedProjectTools } from "./toolkits/projects";
import { hostedQuestionTools } from "./toolkits/questions";
import { hostedSpecialistTools } from "./toolkits/specialists";
import { hostedWebTools } from "./toolkits/web";
import { hostedWorkspaceTools } from "./toolkits/workspace";

export const hostedAgentTools = [
  ...hostedAutomationTools,
  ...hostedBoardTools,
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
