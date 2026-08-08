import type { AgentCapabilityId, AgentDefinition } from "../types.js";
import { ads } from "./ads/agent.js";
import { analyst } from "./analyst/agent.js";
import { brand } from "./brand/agent.js";
import { cmo } from "./cmo/agent.js";
import { content } from "./content/agent.js";
import { engineer } from "./engineer/agent.js";
import { prospector } from "./prospector/agent.js";
import { setup } from "./setup/agent.js";

export interface AgentManifest {
  id: string;
  name: string;
  role: string;
  description: string;
  capabilities?: readonly AgentCapabilityId[];
  delegates?: readonly string[];
}

export const agentManifests: readonly AgentManifest[] = [
  cmo,
  setup,
  brand,
  content,
  engineer,
  analyst,
  prospector,
  ads,
];

/** Browser-safe fallback roster. The runtime supplies composed instructions. */
export const agentRoster: AgentDefinition[] = agentManifests.map((agent) => ({
  ...agent,
  capabilities: agent.capabilities ? [...agent.capabilities] : undefined,
  delegates: agent.delegates ? [...agent.delegates] : undefined,
  instructions: "",
}));
