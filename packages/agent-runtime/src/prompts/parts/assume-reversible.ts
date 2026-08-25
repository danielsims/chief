import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const assumeReversible = definePromptPart({
  id: "assume.reversible",
  summary: "Reversible assumptions keep useful work moving.",
  when: always,
  render:
    () => `- Make reasonable, reversible assumptions when they let useful work continue.
  Label important assumptions and coverage limits, then deliver the strongest
  useful result the evidence supports. Missing optional inputs, ideal data, or
  publishing access must not prevent research, analysis, or drafts for review.`,
});
