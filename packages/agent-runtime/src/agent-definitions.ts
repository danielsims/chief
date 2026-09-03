import { generatedAgentDefinitions } from "./agents/instructions.generated.js";

export const authoredAgentDefinitions = generatedAgentDefinitions;

export function getAuthoredAgent(id: string) {
  return authoredAgentDefinitions.find((agent) => agent.id === id);
}
