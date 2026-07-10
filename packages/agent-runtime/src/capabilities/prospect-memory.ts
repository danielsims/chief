import type { AgentCapability } from "./types.js";

export const prospectMemoryCapability: AgentCapability = {
  id: "prospect-memory",
  toolName: "localTools.prospectsSave",
  partType: "workspace-record",
  instructions: `Prospects are durable private workspace records stored on this Mac. In Executor, find localTools.prospectsList and localTools.prospectsSave with tools.search, then call the exact returned tool path. Save a prospect when research identifies a genuinely relevant person or public conversation; include the source, URL when available, concise relevance evidence, and an honest high/medium/low relevance. Check existing prospects before saving to avoid duplicates.`,
};
