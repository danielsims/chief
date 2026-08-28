import type { Workspace } from "@cloudflare/computer";

import type { AgentBrowser, AgentComputer } from "@chief/agent-computer";

import { CloudflareAgentBrowser } from "./cloudflare-agent-browser";
import { CloudflareAgentComputer } from "./cloudflare-agent-computer";

export interface AgentExecutionEnvironment {
  browser: AgentBrowser;
  computer: AgentComputer;
}

export type AgentExecutionEnvironmentFactory = () => AgentExecutionEnvironment;

export function createAgentExecutionEnvironmentFactory(
  env: Env,
  workspace: Workspace,
): AgentExecutionEnvironmentFactory {
  const cloudflareComputer = new CloudflareAgentComputer(workspace);
  return () => ({
    browser: new CloudflareAgentBrowser(env.BROWSER),
    computer: cloudflareComputer,
  });
}
