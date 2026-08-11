import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentDefinition } from "../types.js";
import { availableCapabilities } from "../capabilities/index.js";
import { composeAgentCapabilities } from "../capabilities/types.js";
import { agentManifests } from "./manifest.js";

export function agentDefinitionsRoot(): string {
  const bundledOrSourceRoot = fileURLToPath(
    new URL("../agents/", import.meta.url),
  );
  const candidates = [
    process.env.CHIEF_AGENT_DEFINITIONS_DIR,
    bundledOrSourceRoot,
    join(process.cwd(), "packages/agent-runtime/src/agents"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const root = candidates.find((candidate) =>
    existsSync(join(candidate, "chief", "instructions.md")),
  );
  if (!root) {
    throw new Error(
      `Chief agent definitions were not found. Checked: ${candidates.join(", ")}`,
    );
  }
  return root;
}

const capabilityById = new Map(
  availableCapabilities.map((capability) => [capability.id, capability]),
);

export function loadAgentDefinitions(): AgentDefinition[] {
  const root = agentDefinitionsRoot();
  return agentManifests.map((manifest) => {
    const baseInstructions = readFileSync(
      join(root, manifest.id, "instructions.md"),
      "utf8",
    ).trim();
    const definition: AgentDefinition = {
      ...manifest,
      capabilities: manifest.capabilities
        ? [...manifest.capabilities]
        : undefined,
      delegates: manifest.delegates ? [...manifest.delegates] : undefined,
      instructions: baseInstructions,
    };
    const capabilities = (manifest.capabilities ?? []).map((id) => {
      const capability = capabilityById.get(id);
      if (!capability) {
        throw new Error(`Unknown capability ${id} on agent ${manifest.id}.`);
      }
      return capability;
    });
    return composeAgentCapabilities(definition, capabilities);
  });
}
