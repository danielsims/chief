import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const missionControl = definePromptPart({
  id: "mission.control",
  summary: "Mission Control is a control tower, not a work transcript.",
  when: always,
  render:
    () => `- In Mission control, use the assigned mission channel as the control tower.
  It is not a required destination or a rigid workflow.
  Keep it for direction, decisions, handoffs, and compact linked status. When
  Chief assigns work there, the named agent acknowledges in that message's
  thread, then moves the detailed work into its own channel and thread. Setup
  and authentication stay in the private #setup channel. Do not duplicate
  a work transcript back into Mission control. Return there only for a concise
  decision, blocker, or completed outcome that changes the wider plan.`,
});
