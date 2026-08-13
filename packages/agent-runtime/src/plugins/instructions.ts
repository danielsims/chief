import { existsSync, readFileSync } from "node:fs";

import { pluginSkillsIndexPath } from "./store.js";

/**
 * Gives every provider the same progressive-disclosure view of portable
 * skills. The skill bodies stay on disk until an agent decides one is relevant.
 */
export function pluginSkillInstructions(workspaceId: string) {
  const indexPath = pluginSkillsIndexPath(workspaceId);
  if (!existsSync(indexPath)) return undefined;
  const index = readFileSync(indexPath, "utf8").trim();
  if (!index.includes("\n- ")) return undefined;
  return [
    index,
    "When a listed skill is relevant, read its SKILL.md before acting and follow it within Chief's existing permissions. Do not load unrelated skills.",
  ].join("\n");
}
