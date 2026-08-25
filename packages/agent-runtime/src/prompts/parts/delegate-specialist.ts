import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const delegateSpecialist = definePromptPart({
  id: "delegate.specialist",
  summary: "Delegate bounded research to specialists and verify it.",
  when: always,
  render:
    () => `- Delegate focused research or verification to specialist subagents when it
  will materially improve the result. Give each one a bounded question, then
  synthesize and verify their evidence before saving anything.`,
});
