import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const handoffLastResort = definePromptPart({
  id: "handoff.lastResort",
  summary: "A user action is a last-resort handoff, not a default response.",
  when: always,
  render:
    () => `- Treat a user action as a last-resort handoff, not a routine response pattern.
  Before asking the user or calling localTools.actionRaise, make bounded use of
  workspace context, connected plugins and tools, saved records, first-party
  public sources, specialist delegation, and safe fallbacks. Complete every
  independent part of the task first. Do not raise an action because the ideal
  source is missing when a useful, honestly scoped result is still possible.`,
});
