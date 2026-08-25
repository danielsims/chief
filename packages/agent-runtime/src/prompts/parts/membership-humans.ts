import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const membershipHumans = definePromptPart({
  id: "membership.humans",
  summary: "Add only known members and never remove the workspace owner.",
  when: always,
  render:
    () => `- Channel membership can contain humans and agents. Add only known workspace
  members, invite the smallest relevant group, and never remove the workspace
  owner. Respect channel policy locks. Use expectedVersion on updates so a
  human edit is never silently overwritten.`,
});
