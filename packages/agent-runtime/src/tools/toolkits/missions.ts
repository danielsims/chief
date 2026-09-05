import { z } from "zod";

import { defineAgentTool } from "../definition.js";
import { boundedText } from "../input.js";

export const listMissionsDefinition = defineAgentTool({
  method: "GET",
  path: "/local-tools/missions",
  operation: {
    operationId: "missions.list",
    summary: "Read this business's missions and experiment history",
  },
  inputSchema: z.object({}),
});
export const createMissionDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/missions",
  operation: {
    operationId: "missions.create",
    summary:
      "Record a bounded business mission in its feature or campaign channel",
    description:
      "Create the mission channel and add its owner/collaborators first. Reuse a stable id. Metric missions require a real measured baseline, source and evaluation window. This records work; use recurring_work_propose separately for approved repeat execution. Publish a concise brief and channel link after success.",
  },
  inputSchema: z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{4,99}$/u),
    conversationId: boundedText(160),
    title: boundedText(200),
    objective: boundedText(4000),
    ownerAgentId: boundedText(120),
    collaborators: z.array(boundedText(120)).max(12).default([]),
    projectId: boundedText(160).optional(),
    success: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("deliverable"),
        description: boundedText(2000),
      }),
      z.object({
        kind: z.literal("metric"),
        name: boundedText(120),
        unit: z.string().max(40),
        direction: z.enum(["increase", "decrease"]),
        baseline: z.number(),
        target: z.number(),
        source: boundedText(2000),
        evaluationWindow: boundedText(1000),
      }),
    ]),
    maxExperiments: z.number().int().min(1).max(100),
    deadline: boundedText(100),
    constraints: boundedText(4000),
  }),
});
export const recordMissionExperimentDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/missions/{missionId}/experiments",
  operation: {
    operationId: "missions.recordExperiment",
    summary: "Record evidence from one bounded mission experiment",
    description:
      "Use a stable experiment id. Record the hypothesis, actual change, measurement and evidence. Only keep a result that improves the current best. Use null value and inconclusive when data is insufficient. The relay stops completed/exhausted missions.",
  },
  inputSchema: z.object({
    id: boundedText(120),
    hypothesis: boundedText(2000),
    change: boundedText(4000),
    value: z.number().nullable(),
    evidence: boundedText(4000),
    decision: z.enum(["keep", "discard", "inconclusive"]),
  }),
});
export const updateMissionStatusDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/missions/{missionId}/status",
  operation: {
    operationId: "missions.updateStatus",
    summary: "Pause, resume or complete a mission with evidence",
  },
  inputSchema: z.object({
    status: z.enum(["active", "paused", "completed"]),
    evidence: boundedText(4000),
  }),
});
export const missionToolDefinitions = [
  listMissionsDefinition,
  createMissionDefinition,
  recordMissionExperimentDefinition,
  updateMissionStatusDefinition,
];
