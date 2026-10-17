import type { AgentBrowser, AgentComputer } from "@chief/agent-computer";
import type { AgentJob, AgentPrincipal } from "@chief/relay-contracts";

export interface HostedAgentToolContext {
  computer: AgentComputer;
  browser?: AgentBrowser;
  /** Whether this turn exposes the durable computer tools to the agent. */
  computerEnabled: boolean;
  env: Env;
  job: AgentJob;
  principal: AgentPrincipal;
}
