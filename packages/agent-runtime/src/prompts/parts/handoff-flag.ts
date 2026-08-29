import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const handoffFlag = definePromptPart({
  id: "handoff.flag",
  summary: "Flag a genuine human handoff with actionRaise.",
  when: always,
  render:
    () => `- When a genuine user handoff meets the rules above, flag it with the
  localTools.actionRaise Executor tool. State concretely what the user must do
  and why, include the useful work already completed, and reuse a stable
  dedupeKey so an equivalent blocker is never raised twice.`,
});
