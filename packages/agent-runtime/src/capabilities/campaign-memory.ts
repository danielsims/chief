import type { AgentCapability } from "./types.js";

export const campaignMemoryCapability: AgentCapability = {
  id: "campaign-memory",
  toolName: "localTools.campaignsSave",
  partType: "workspace-record",
  instructions: `Campaign plans are durable private workspace records stored on this Mac. In Executor, find localTools.campaignsList and localTools.campaignsSave with tools.search, then call the exact returned tool path. Save a draft before proposing launch, use in_review when explicit user approval is still required, and only mark a campaign live when a connected ads tool confirms it. Keep provider, objective, budget, spend and revenue grounded in the connected account or the user's stated plan. Never invent performance values.`,
};
