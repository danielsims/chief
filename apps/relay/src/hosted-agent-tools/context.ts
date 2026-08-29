import type { AgentBrowser, AgentComputer } from "@chief/agent-computer";
import type { AgentJob, AgentPrincipal } from "@chief/relay-contracts";

export interface HostedAgentToolContext {
  computer: AgentComputer;
  browser?: AgentBrowser;
  env: Env;
  job: AgentJob;
  principal: AgentPrincipal;
}
