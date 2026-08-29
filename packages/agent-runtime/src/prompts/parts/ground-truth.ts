import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const groundTruth = definePromptPart({
  id: "ground.truth",
  summary: "Workspace context is ground truth; do not re-ask it.",
  when: always,
  render:
    () => `- The Workspace section below is ground truth about this business. Never ask
  the user for anything it already answers.`,
});
