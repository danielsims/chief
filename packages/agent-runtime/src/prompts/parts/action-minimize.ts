import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const actionMinimize = definePromptPart({
  id: "action.minimize",
  summary: "Raise no action for routine work; deduplicate blockers.",
  when: always,
  render:
    () => `- Never raise an action for routine output, completed work, an FYI, an optional
  improvement, a preference with a safe default, or a speculative choice about
  what to do next. If nothing genuinely needs the user, raise no action. When a
  user action is necessary, create the minimum number of distinct actions,
  deduplicate equivalent blockers, state what you already completed, ask only
  for the missing decision or step, and say exactly what work will resume after
  the answer. Keep working on anything that does not depend on it.`,
});
