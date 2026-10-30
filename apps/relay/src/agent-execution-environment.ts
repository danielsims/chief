import type { Workspace } from "@cloudflare/computer";

import type { AgentBrowser, AgentComputer } from "@chief/agent-computer";
import type { AgentJob } from "@chief/relay-contracts";

import { CloudflareAgentBrowser } from "./cloudflare-agent-browser";
import { CloudflareAgentComputer } from "./cloudflare-agent-computer";
import { RemoteAgentBrowser } from "./remote-agent-browser";
import { RemoteComputerClient } from "./remote-computer-client";

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
  const browserUrl = env.BROWSER_BASE_URL?.trim();
  const remoteUrl = browserUrl?.length
    ? browserUrl
    : env.COMPUTER_BASE_URL?.trim();
  const secret = browserUrl
    ? env.BROWSER_AUTH_SECRET
    : env.COMPUTER_AUTH_SECRET;
  return (job) => ({
    browser:
      localBrowserConfigured(env) && remoteUrl && secret
        ? new RemoteAgentBrowser(
            new RemoteComputerClient(remoteUrl, secret, job, "browser"),
          )
        : new CloudflareAgentBrowser(env.BROWSER),
    computer: cloudflareComputer,
  });
}

export function localBrowserConfigured(
  env: Pick<
    Env,
    | "COMPUTER_BASE_URL"
    | "COMPUTER_AUTH_SECRET"
    | "BROWSER_BASE_URL"
    | "BROWSER_AUTH_SECRET"
  >,
) {
  if (env.BROWSER_BASE_URL?.trim()) return !!env.BROWSER_AUTH_SECRET?.trim();
  return !!env.COMPUTER_BASE_URL?.trim() && !!env.COMPUTER_AUTH_SECRET?.trim();
}
