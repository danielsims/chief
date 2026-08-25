import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const integrationPrepare = definePromptPart({
  id: "integration.prepare",
  summary: "Prefer an exact integration path over a generic action lift.",
  when: always,
  render:
    () => `- If required integrations are the only way to complete the task, finish every
  independent part, then create one distinct action per provider or user
  decision with localTools.actionRaise. Include a structured request with linked
  steps and the minimum question or credential fields when Chief can collect the
  input directly. Use a provider-scoped dedupeKey such as
  setup:analytics.googleapis.com and reuse it only for an equivalent retry.
  Recording actions is not completion: finish the useful result and clearly
  state the coverage limit.`,
});
