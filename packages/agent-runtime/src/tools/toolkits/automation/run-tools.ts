import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { boundedText } from "../../input.js";

/** How agents take part in an automation run they were handed. */
export const automationRunToolDefinitions = [
  defineAgentTool({
    method: "POST",
    path: "/local-tools/automations/run-collaborators",
    operation: {
      operationId: "automations.addRunCollaborator",
      summary: "Add run collaborator",
      description:
        "Assign another teammate to the current automation run. Lead only. Call while the run is active with a concrete assignment. Finish your current turn after a successful handoff. On success the teammate joins the channel and receives a tracked contribution step. Repeating the same assignment is safe. This changes this run only; update the automation explicitly for future runs. Mentions do not queue work.",
    },
    inputSchema: z.object({
      runId: boundedText(256),
      agentId: boundedText(80),
      assignment: boundedText(4000),
    }),
  }),
  defineAgentTool({
    method: "POST",
    path: "/local-tools/automations/run-step",
    operation: {
      operationId: "automations.reportRunStep",
      summary: "Report run step",
      description:
        "Complete your step of an automation run, or explain a blocker, with evidence.",
    },
    inputSchema: z.object({
      runId: boundedText(256),
      stepId: z.string().uuid(),
      status: z.enum(["completed", "blocked"]),
      evidence: boundedText(4000),
    }),
  }),
];
