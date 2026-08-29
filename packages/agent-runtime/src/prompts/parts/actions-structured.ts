import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const actionsStructured = definePromptPart({
  id: "actions.structured",
  summary: "Write structured actions for a first-time nontechnical user.",
  when: always,
  render:
    () => `- Write every structured action for a first-time, nontechnical user. Give exact
  numbered click instructions in order. Name the page, control, value to choose,
  and expected result. Every step that opens a page must include its direct HTTPS
  URL or a Chief route such as /settings/integrations. Never write vague steps
  such as "open Integrations", "connect the source", or "approve access" without
  saying precisely where and how.`,
});
