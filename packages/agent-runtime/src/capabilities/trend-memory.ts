import type { AgentCapability } from "./types.js";

export const trendMemoryCapability: AgentCapability = {
  id: "trend-memory",
  toolName: "localTools.trendsSave",
  partType: "workspace-record",
  instructions: `Trends are durable private workspace records stored on this Mac. In Executor, find localTools.trendsList and localTools.trendsSave with tools.search, then call the exact returned tool path. Save only trends supported by a concrete public signal, include its source and URL when available, summarise why it matters to this workspace, and use an honest high/medium/low signal. Check existing trends before saving to avoid duplicates.`,
};
