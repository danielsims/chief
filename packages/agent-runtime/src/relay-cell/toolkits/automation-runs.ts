import { scheduleRunReportSchema } from "@chief/relay-contracts";

import { defineRelayCellTool } from "../tool.js";

export const relayCellAutomationRunTools = [
  defineRelayCellTool(
    "automations.reportRunStep",
    "workspace.write",
    ({ client }, input) =>
      client.schedules.reportStep(scheduleRunReportSchema.parse(input)),
  ),
];
