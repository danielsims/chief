import { existsSync, readFileSync } from "node:fs";

import { pluginSkillsIndexPath } from "./store.js";

const START = "<!-- chief:plugin-skills:start -->";
const END = "<!-- chief:plugin-skills:end -->";

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
    START,
    index,
    "When a listed skill is relevant, read its SKILL.md before acting and follow it within Chief's existing permissions. Do not load unrelated skills.",
    END,
  ].join("\n");
}

/** Replace the host-owned skill index instead of accumulating it each turn. */
export function withPluginSkillInstructions(
  instructions: string,
  workspaceId: string,
) {
  const start = instructions.indexOf(START);
  const end = instructions.indexOf(END, Math.max(0, start));
  const base =
    start >= 0 && end >= start
      ? `${instructions.slice(0, start)}${instructions.slice(end + END.length)}`.trim()
      : instructions.trim();
  return [base, pluginSkillInstructions(workspaceId)]
    .filter(Boolean)
    .join("\n\n");
}
