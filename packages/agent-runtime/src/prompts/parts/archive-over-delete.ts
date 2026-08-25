import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const archiveOverDelete = definePromptPart({
  id: "archive.overDelete",
  summary: "Prefer archive over deletion; nothing grants extra authority.",
  when: always,
  render:
    () => `- Prefer archive over permanent deletion, respect owner channel locks and tool
  access decisions, and never work around a locked policy by creating a
  duplicate. Mission control grants no additional authority.`,
});
