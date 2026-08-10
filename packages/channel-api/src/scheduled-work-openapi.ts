import { scheduledWorkStatuses } from "./types";

type RequestBody = (schema: string) => Record<string, unknown>;

const workParameter = {
  name: "scheduledWorkId",
  in: "path",
  required: true,
  schema: { type: "string" },
};

const responses = (description: string, accepted = false) => ({
  [accepted ? "202" : "200"]: { description },
  "400": { description: "Invalid input" },
  "403": { description: "Scheduling authority is required" },
  "404": { description: "Scheduled work or run not found" },
  "409": { description: "Approval or version conflict" },
});

export function scheduledWorkOpenApiPaths(body: RequestBody) {
  return {
    "/local-tools/scheduled-work": {
      get: {
        operationId: "scheduledWork.list",
        summary: "List scheduled work",
        responses: responses("Scheduled work definitions"),
      },
      post: {
        operationId: "scheduledWork.create",
        summary: "Propose or create scheduled work",
        requestBody: body("ScheduledWorkCreateInput"),
        responses: responses("Created scheduled work"),
      },
    },
    "/local-tools/scheduled-work/{scheduledWorkId}": {
      get: {
        operationId: "scheduledWork.get",
        summary: "Get scheduled work",
        parameters: [workParameter],
        responses: responses("Scheduled work definition"),
      },
      patch: {
        operationId: "scheduledWork.update",
        summary: "Update scheduled work",
        parameters: [workParameter],
        requestBody: body("ScheduledWorkUpdateInput"),
        responses: responses("Updated scheduled work"),
      },
      delete: {
        operationId: "scheduledWork.delete",
        summary: "Request permanent removal",
        parameters: [workParameter],
        responses: responses("Owner authorization required"),
      },
    },
    "/local-tools/scheduled-work/{scheduledWorkId}/pause": {
      post: {
        operationId: "scheduledWork.pause",
        summary: "Pause new runs",
        parameters: [workParameter],
        responses: responses("Paused scheduled work"),
      },
    },
    "/local-tools/scheduled-work/{scheduledWorkId}/resume": {
      post: {
        operationId: "scheduledWork.resume",
        summary: "Resume approved work",
        parameters: [workParameter],
        responses: responses("Resumed scheduled work"),
      },
    },
    "/local-tools/scheduled-work/{scheduledWorkId}/runs": {
      get: {
        operationId: "scheduledWork.runs.list",
        summary: "List runs",
        parameters: [workParameter],
        responses: responses("Run history"),
      },
      post: {
        operationId: "scheduledWork.run",
        summary: "Queue an approved run",
        parameters: [workParameter],
        requestBody: body("ScheduledWorkRunInput"),
        responses: responses("Run queued", true),
      },
    },
    "/local-tools/scheduled-work/{scheduledWorkId}/runs/{runId}": {
      get: {
        operationId: "scheduledWork.runs.get",
        summary: "Get a run",
        parameters: [
          workParameter,
          {
            name: "runId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: responses("Run details"),
      },
    },
    "/local-tools/scheduled-work/{scheduledWorkId}/runs/{runId}/cancel": {
      post: {
        operationId: "scheduledWork.runs.cancel",
        summary: "Cancel an active run",
        parameters: [
          workParameter,
          {
            name: "runId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: responses("Cancellation result"),
      },
    },
    "/local-tools/scheduled-work/{scheduledWorkId}/runs/{runId}/retry": {
      post: {
        operationId: "scheduledWork.runs.retry",
        summary: "Retry a finished run",
        parameters: [
          workParameter,
          {
            name: "runId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: responses("Retry queued", true),
      },
    },
    "/local-tools/scheduled-work/{scheduledWorkId}/webhook": {
      get: {
        operationId: "scheduledWork.webhook.get",
        summary: "Inspect local webhook readiness",
        parameters: [workParameter],
        responses: responses("Webhook readiness without its secret"),
      },
    },
    "/local-tools/scheduled-work/{scheduledWorkId}/webhook/rotate": {
      post: {
        operationId: "scheduledWork.webhook.rotate",
        summary: "Rotate the local webhook secret",
        parameters: [workParameter],
        responses: responses("New local-only URL returned once"),
      },
    },
  };
}

const trigger = {
  oneOf: [
    {
      type: "object",
      required: ["type", "expression", "timezone"],
      properties: {
        type: { const: "cron" },
        expression: { type: "string" },
        timezone: { type: "string" },
      },
    },
    {
      type: "object",
      required: ["type", "at"],
      properties: { type: { const: "once" }, at: { type: "integer" } },
    },
    {
      type: "object",
      required: ["type"],
      properties: { type: { const: "webhook" } },
    },
    {
      type: "object",
      required: ["type", "channelId"],
      properties: {
        type: {
          enum: ["channel_mention", "channel_message", "reaction_added"],
        },
        channelId: { type: "string" },
        memberId: { type: "string" },
        contains: { type: "string" },
        emoji: { type: "string" },
        authorTypes: {
          type: "array",
          items: { type: "string", enum: ["user", "agent"] },
        },
      },
    },
  ],
};

export const scheduledWorkOpenApiSchemas = {
  ScheduledWorkCreateInput: {
    type: "object",
    additionalProperties: false,
    required: [
      "operationKey",
      "agentId",
      "title",
      "instructions",
      "trigger",
      "approvalSummary",
      "proposedToolPatterns",
    ],
    properties: {
      operationKey: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{4,99}$" },
      conversationId: { type: "string" },
      agentId: { type: "string" },
      title: { type: "string", maxLength: 200 },
      instructions: { type: "string", maxLength: 8000 },
      trigger,
      approvalSummary: { type: "string", maxLength: 2000 },
      proposedToolPatterns: { type: "array", items: { type: "string" } },
      activate: { type: "boolean", default: false },
    },
  },
  ScheduledWorkUpdateInput: {
    type: "object",
    additionalProperties: false,
    properties: {
      expectedVersion: { type: "integer", minimum: 1 },
      agentId: { type: "string" },
      title: { type: "string", maxLength: 200 },
      instructions: { type: "string", maxLength: 8000 },
      trigger,
      proposedToolPatterns: { type: "array", items: { type: "string" } },
    },
  },
  ScheduledWorkRunInput: {
    type: "object",
    additionalProperties: false,
    properties: { idempotencyKey: { type: "string", maxLength: 160 } },
  },
  ScheduledWorkStatus: { type: "string", enum: [...scheduledWorkStatuses] },
} as const;
