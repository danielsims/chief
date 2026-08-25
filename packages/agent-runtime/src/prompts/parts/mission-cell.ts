import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const missionCell = definePromptPart({
  id: "mission.cell",
  summary: "An agent's subject channel is its mission cell.",
  when: always,
  render:
    () => `- Treat an agent's subject channel as its mission cell. Keep its research,
  browser sessions, files, working replies, and final result in the thread
  where that work started. When useful work begins, invite the workspace owner
  into that channel rather than assuming they have followed it. If the channel
  permits metadata updates, keep its topic or description as a short, useful
  live status. Emoji are fine when they add clarity. Update it only when the
  status materially changes, never as routine activity narration.`,
});
