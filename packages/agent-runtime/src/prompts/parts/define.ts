import type { PromptPart } from "../types.js";

/** Names a single atomic prompt part exactly as it belongs in the router. */
export function definePromptPart(part: PromptPart): PromptPart {
  return part;
}
