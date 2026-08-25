/**
 * Generates src/agents/instructions.generated.ts from the authored
 * agents/<id>/instructions.md files, so the persona instruction text is
 * available to the Cloudflare Worker Durable Object (which has no node:fs).
 *
 * The .md files remain the single source of truth for each agent's voice. This
 * output is a build artifact: regenerate after editing an instructions.md.
 *
 *   pnpm --filter @chief/agent-runtime generate:agent-instructions
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { agentManifests } from "../src/agents/manifest.js";

const agentsRoot = fileURLToPath(new URL("../src/agents/", import.meta.url));
const outputPath = join(agentsRoot, "instructions.generated.ts");

function escapeTemplateLiteral(source: string) {
  return source
    .replace(/\\/gu, "\\\\")
    .replace(/`/gu, "\\`")
    .replace(/\$\{/gu, "\\${");
}

const blocks = agentManifests
  .map((agent) => {
    const path = join(agentsRoot, agent.id, "instructions.md");
    const instructions = readFileSync(path, "utf8").trim();
    return `// eslint-disable-next-line no-template-curly-in-string\n  ${JSON.stringify(agent.id)}: \`${escapeTemplateLiteral(instructions)}\`,`;
  })
  .join("\n\n");

const banner = `/**
 * GENERATED FILE - do not edit by hand. Regenerate with
 * \`pnpm --filter @chief/agent-runtime generate:agent-instructions\`.
 * Source of truth: the per-agent \`src/agents/<id>/instructions.md\` files.
 */
import type { AgentDefinition } from "../types.js";
import { agentManifests } from "./manifest.js";
import { availableCapabilities } from "../capabilities/index.js";
import { composeAgentCapabilities } from "../capabilities/types.js";

export const agentInstructionById: Record<string, string> = {
${blocks}
};

/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
export const generatedAgentDefinitions: AgentDefinition[] = agentManifests.map((agent) => {
  const instructions = agentInstructionById[agent.id];
  if (!instructions) throw new Error(\`Missing instructions for agent \${agent.id}.\`);
  const definition: AgentDefinition = {
    ...agent,
    capabilities: agent.capabilities ? [...agent.capabilities] : undefined,
    delegates: agent.delegates ? [...agent.delegates] : undefined,
    instructions,
  };
  const capabilities = (agent.capabilities ?? []).map((id) => {
    const capability = availableCapabilities.find((item) => item.id === id);
    if (!capability) throw new Error(\`Unknown capability \${id}.\`);
    return capability;
  });
  return composeAgentCapabilities(definition, capabilities);
});
`;

writeFileSync(outputPath, banner, "utf8");
console.info(`Generated ${outputPath}`);
