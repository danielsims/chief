import type { Workspace } from "@cloudflare/computer";

import type { AgentBrowser, AgentComputer } from "@chief/agent-computer";
import type { AgentJob } from "@chief/relay-contracts";

import { CloudflareAgentBrowser } from "./cloudflare-agent-browser";
import { CloudflareAgentComputer } from "./cloudflare-agent-computer";
import { RemoteAgentBrowser } from "./remote-agent-browser";
import { RemoteAgentComputer } from "./remote-agent-computer";
import { remoteComputerClient } from "./remote-computer-client";

export interface AgentExecutionEnvironment {
  browser: AgentBrowser;
  computer: AgentComputer;
}

export type AgentExecutionEnvironmentFactory = (
  job: AgentJob,
) => AgentExecutionEnvironment;

export function createAgentExecutionEnvironmentFactory(
  env: Env,
  workspace: Workspace,
): AgentExecutionEnvironmentFactory {
  const cloudflareComputer = new CloudflareAgentComputer(workspace);
  return (job) => {
    const remote = remoteComputerClient(env, job);
    return remote
      ? {
          browser: new RemoteAgentBrowser(remote),
          computer: new RemoteAgentComputer(remote),
        }
      : {
          browser: new CloudflareAgentBrowser(env.BROWSER),
          computer: cloudflareComputer,
        };
  };
}
