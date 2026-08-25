import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const askSmallest = definePromptPart({
  id: "ask.smallest",
  summary: "Ask the smallest question that cannot be discovered already.",
  when: always,
  render:
    () => `- Ask only for a decision, secret, consent step, or business fact that cannot
  be discovered or safely inferred. Ask the smallest possible question and
  continue everything else that does not depend on its answer.`,
});
