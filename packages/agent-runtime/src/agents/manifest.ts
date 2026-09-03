import type { AgentCapabilityId, AgentDefinition } from "../types.js";
import { ads } from "./ads/agent.js";
import { analyst } from "./analyst/agent.js";
import { brand } from "./brand/agent.js";
import { chief } from "./chief/agent.js";
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
  chief,
  setup,
  brand,
  content,
  engineer,
  analyst,
  prospector,
  ads,
];

/** Browser-safe fallback roster. The runtime supplies composed instructions. */
export const agentRoster: AgentDefinition[] = agentManifests.map((agent) => {
  const definition: AgentDefinition = {
    ...agent,
    capabilities: agent.capabilities ? [...agent.capabilities] : undefined,
    delegates: agent.delegates ? [...agent.delegates] : undefined,
    instructions: "",
  };
  if (!agent.delegates?.length) return definition;
  const byId = new Map(agentManifests.map((item) => [item.id, item]));
  return {
    ...definition,
    subagents: agent.delegates.flatMap((delegateId) => {
      const delegate = byId.get(delegateId);
      return delegate
        ? [
            {
              id: delegate.id,
              name: delegate.name,
              role: delegate.role,
              description: delegate.description,
              instructions: "",
              capabilities: delegate.capabilities
                ? [...delegate.capabilities]
                : undefined,
            },
          ]
        : [];
    }),
  };
});
