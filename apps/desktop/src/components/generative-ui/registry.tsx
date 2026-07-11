import type {
  AgentCapabilityId,
  ContentBlock,
} from "@marketer/agent-runtime/types";
import type { GenerativePartModule, GenerativePartRenderer } from "./types";

// Vite discovers one renderer per file. Adding a new generative component no
// longer requires editing the conversation renderer or a central switch.
const modules = import.meta.glob<GenerativePartModule>("./parts/*.tsx", {
  eager: true,
});

const renderers = new Map<string, GenerativePartRenderer>();
for (const [path, module] of Object.entries(modules)) {
  const renderer = module.default;
  if (renderers.has(renderer.partType)) {
    throw new Error(
      `Duplicate generative UI renderer for ${renderer.partType} (${path}).`,
    );
  }
  renderers.set(renderer.partType, renderer);
}

export function renderGenerativePart(
  part: ContentBlock,
  capabilities: readonly AgentCapabilityId[],
) {
  const renderer = renderers.get(part.type);
  if (
    !renderer ||
    (renderer.capability && !capabilities.includes(renderer.capability))
  ) {
    return undefined;
  }
  return renderer.render(part);
}
