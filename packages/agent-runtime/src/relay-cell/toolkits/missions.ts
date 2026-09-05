import {
  missionCreateSchema,
  missionExperimentInputSchema,
  missionStatusUpdateSchema,
  scheduleRunReportSchema,
} from "@chief/relay-contracts";

import { requiredString } from "../input.js";
import { defineRelayCellTool } from "../tool.js";

export const relayCellMissionTools = [
  defineRelayCellTool(
    "missions.reportRunStep",
    "workspace.write",
    ({ client }, input) =>
      client.schedules.reportStep(scheduleRunReportSchema.parse(input)),
  ),
  defineRelayCellTool(
    "missions.list",
    "workspace.read",
    async ({ client }) => ({ missions: await client.listMissions() }),
  ),
  defineRelayCellTool(
    "missions.create",
    "workspace.write",
    async ({ client }, input) =>
      client.createMission(missionCreateSchema.parse(input)),
  ),
  defineRelayCellTool(
    "missions.recordExperiment",
    "workspace.write",
    async ({ client }, input) => {
      const { missionId: _missionId, ...experiment } = input;
      return client.recordMissionExperiment(
        requiredString(input, "missionId"),
        missionExperimentInputSchema.parse(experiment),
      );
    },
  ),
  defineRelayCellTool(
    "missions.updateStatus",
    "workspace.write",
    async ({ client }, input) => {
      const { missionId: _missionId, ...update } = input;
      const parsed = missionStatusUpdateSchema.parse(update);
      return client.updateMissionStatus(
        requiredString(input, "missionId"),
        parsed.status,
        parsed.evidence,
      );
    },
  ),
];
