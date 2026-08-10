import { messageOpenApiPaths, messageOpenApiSchemas } from "./message-openapi";
import {
  scheduledWorkOpenApiPaths,
  scheduledWorkOpenApiSchemas,
} from "./scheduled-work-openapi";
import {
  channelAgentPermissions,
  channelKinds,
  channelVisibilities,
  channelWorkstreamStatuses,
} from "./types";

type RequestBody = (schema: string) => Record<string, unknown>;

const channelParameter = {
  name: "channelId",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "Stable channel id or slug",
};

const memberParameter = {
  name: "memberId",
  in: "path",
  required: true,
  schema: { type: "string" },
};

const sessionParameter = {
  name: "sessionId",
  in: "query",
  required: false,
  schema: { type: "string", maxLength: 160 },
  description: "Exact current Chief session id used to attribute the caller",
};

function withCallerSession(
  paths: Record<string, Record<string, Record<string, unknown>>>,
) {
  for (const path of Object.values(paths)) {
    for (const operation of Object.values(path)) {
      const existingParameters = operation.parameters;
      const parameters: unknown[] = Array.isArray(existingParameters)
        ? (existingParameters as unknown[])
        : [];
      operation.parameters = [...parameters, sessionParameter];
    }
  }
  return paths;
}

const response = (description: string, schema: string) => ({
  "200": {
    description,
    content: {
      "application/json": {
        schema: { $ref: `#/components/schemas/${schema}` },
      },
    },
  },
  "400": errorResponse("Invalid input"),
  "403": errorResponse("The channel policy does not permit this action"),
  "404": errorResponse("Channel or member not found"),
  "409": errorResponse("Version conflict or duplicate channel name"),
});

const errorResponse = (description: string) => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ChannelErrorResponse" },
    },
  },
});

export function channelOpenApiPaths(body: RequestBody) {
  return withCallerSession({
    "/local-tools/channels": {
      get: {
        operationId: "channels.list",
        summary: "List workspace channels",
        parameters: [
          {
            name: "includeArchived",
            in: "query",
            schema: { type: "boolean", default: false },
          },
          {
            name: "query",
            in: "query",
            schema: { type: "string", maxLength: 120 },
          },
        ],
        responses: response("Visible channels", "ChannelListResponse"),
      },
      post: {
        operationId: "channels.create",
        summary: "Create a standard or feature channel",
        description:
          "Use a stable operationKey for retries. The calling agent is added automatically; additional agents are validated before the channel is written.",
        requestBody: body("ChannelCreateInput"),
        responses: response(
          "Created or existing idempotent channel",
          "ChannelResponse",
        ),
      },
    },
    "/local-tools/channels/{channelId}": {
      get: {
        operationId: "channels.get",
        summary: "Get channel details",
        parameters: [channelParameter],
        responses: response("Channel details", "ChannelResponse"),
      },
      patch: {
        operationId: "channels.update",
        summary: "Update metadata or feature-work state",
        parameters: [channelParameter],
        requestBody: body("ChannelUpdateInput"),
        responses: response("Updated channel", "ChannelResponse"),
      },
    },
    "/local-tools/channels/{channelId}/archive": {
      post: {
        operationId: "channels.archive",
        summary: "Archive a channel without losing history",
        parameters: [channelParameter],
        requestBody: body("ChannelVersionInput"),
        responses: response("Archived channel", "ChannelResponse"),
      },
    },
    "/local-tools/channels/{channelId}/unarchive": {
      post: {
        operationId: "channels.unarchive",
        summary: "Restore an archived channel",
        parameters: [channelParameter],
        requestBody: body("ChannelVersionInput"),
        responses: response("Restored channel", "ChannelResponse"),
      },
    },
    "/local-tools/channels/{channelId}/join": {
      post: {
        operationId: "channels.join",
        summary: "Join an active public channel",
        parameters: [channelParameter],
        requestBody: body("ChannelVersionInput"),
        responses: response("Updated membership", "ChannelResponse"),
      },
    },
    "/local-tools/channels/{channelId}/leave": {
      post: {
        operationId: "channels.leave",
        summary: "Leave a channel",
        parameters: [channelParameter],
        requestBody: body("ChannelVersionInput"),
        responses: response("Updated membership", "ChannelResponse"),
      },
    },
    "/local-tools/channels/{channelId}/members": {
      get: {
        operationId: "channels.members.list",
        summary: "List channel members",
        parameters: [channelParameter],
        responses: response("Channel members", "ChannelMembersResponse"),
      },
      post: {
        operationId: "channels.members.add",
        summary: "Add validated agents to a channel",
        parameters: [channelParameter],
        requestBody: body("ChannelMembersAddInput"),
        responses: response("Updated membership", "ChannelResponse"),
      },
    },
    "/local-tools/channels/{channelId}/members/{memberId}": {
      delete: {
        operationId: "channels.members.remove",
        summary: "Remove a member from a channel",
        parameters: [channelParameter, memberParameter],
        requestBody: body("ChannelVersionInput"),
        responses: response("Updated membership", "ChannelResponse"),
      },
    },
    ...messageOpenApiPaths(body),
    ...scheduledWorkOpenApiPaths(body),
    "/local-tools/channels/{channelId}/activity": {
      get: {
        operationId: "channels.activity.list",
        summary: "Read the channel management audit trail",
        parameters: [channelParameter],
        responses: response("Channel activity", "ChannelActivityResponse"),
      },
    },
    "/local-tools/channels/{channelId}/deletion-request": {
      post: {
        operationId: "channels.deletion.request",
        summary: "Ask the workspace owner to permanently delete a channel",
        parameters: [channelParameter],
        requestBody: body("ChannelDeletionRequestInput"),
        responses: response("Owner action item", "ChannelDeletionResponse"),
      },
    },
  });
}

export const channelOpenApiSchemas = {
  ...messageOpenApiSchemas,
  ...scheduledWorkOpenApiSchemas,
  ChannelActor: {
    type: "object",
    additionalProperties: false,
    required: ["type", "id", "name"],
    properties: {
      type: { type: "string", enum: ["user", "agent"] },
      id: { type: "string" },
      name: { type: "string" },
    },
  },
  Channel: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "slug",
      "name",
      "topic",
      "description",
      "visibility",
      "kind",
      "lifecycle",
      "createdBy",
      "agentIds",
      "agentPermissions",
      "version",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      id: { type: "string", description: "Stable channel identifier" },
      slug: {
        type: "string",
        description: "Stable URL-safe channel name retained across renames",
      },
      name: { type: "string" },
      topic: { type: "string" },
      description: { type: "string" },
      visibility: { type: "string", enum: [...channelVisibilities] },
      kind: { type: "string", enum: [...channelKinds] },
      lifecycle: { type: "string", enum: ["active", "archived"] },
      archivedAt: { type: "integer", description: "Unix time in milliseconds" },
      createdBy: { $ref: "#/components/schemas/ChannelActor" },
      agentIds: { type: "array", items: { type: "string" } },
      agentPermissions: {
        type: "array",
        uniqueItems: true,
        items: { type: "string", enum: [...channelAgentPermissions] },
      },
      workstream: { $ref: "#/components/schemas/ChannelWorkstreamInput" },
      version: {
        type: "integer",
        minimum: 1,
        description: "Use as expectedVersion for conflict-safe writes",
      },
      createdAt: { type: "integer", description: "Unix time in milliseconds" },
      updatedAt: { type: "integer", description: "Unix time in milliseconds" },
    },
  },
  ChannelResponse: {
    type: "object",
    required: ["channel"],
    properties: {
      channel: { $ref: "#/components/schemas/Channel" },
    },
  },
  ChannelListResponse: {
    type: "object",
    required: ["channels"],
    properties: {
      channels: {
        type: "array",
        items: { $ref: "#/components/schemas/Channel" },
      },
    },
  },
  ChannelMember: {
    type: "object",
    required: ["id", "type", "role"],
    properties: {
      id: { type: "string" },
      type: { type: "string", enum: ["user", "agent"] },
      role: { type: "string", enum: ["owner", "member"] },
    },
  },
  ChannelMembersResponse: {
    type: "object",
    required: ["members"],
    properties: {
      members: {
        type: "array",
        items: { $ref: "#/components/schemas/ChannelMember" },
      },
    },
  },
  ChannelEvent: {
    type: "object",
    required: ["id", "channelId", "kind", "content", "actor", "createdAt"],
    properties: {
      id: { type: "string" },
      channelId: { type: "string" },
      kind: { type: "integer", enum: [9] },
      content: { type: "string" },
      actor: { $ref: "#/components/schemas/ChannelActor" },
      createdAt: { type: "integer", description: "Unix time in milliseconds" },
    },
  },
  ChannelEventResponse: {
    type: "object",
    required: ["event"],
    properties: {
      event: { $ref: "#/components/schemas/ChannelEvent" },
    },
  },
  ChannelAuditEntry: {
    type: "object",
    required: ["id", "channelId", "action", "actor", "detail", "createdAt"],
    properties: {
      id: { type: "string" },
      channelId: { type: "string" },
      action: {
        type: "string",
        enum: [
          "channel.created",
          "channel.updated",
          "channel.archived",
          "channel.unarchived",
          "channel.deletion_requested",
          "member.joined",
          "member.left",
          "member.added",
          "member.removed",
          "message.posted",
          "message.edited",
          "message.deleted",
          "reaction.added",
          "reaction.removed",
          "policy.updated",
        ],
      },
      actor: { $ref: "#/components/schemas/ChannelActor" },
      detail: { type: "object", additionalProperties: true },
      sequence: { type: "integer", minimum: 1 },
      previousHash: { type: "string" },
      hash: { type: "string" },
      createdAt: { type: "integer", description: "Unix time in milliseconds" },
    },
  },
  ChannelActivityResponse: {
    type: "object",
    required: ["activity"],
    properties: {
      activity: {
        type: "array",
        items: { $ref: "#/components/schemas/ChannelAuditEntry" },
      },
    },
  },
  ChannelDeletionResponse: {
    type: "object",
    required: ["actionItem"],
    properties: {
      actionItem: {
        type: "object",
        description: "Owner-visible review item; no channel data is deleted",
        additionalProperties: true,
      },
    },
  },
  ChannelErrorResponse: {
    type: "object",
    required: ["error", "code"],
    properties: {
      error: { type: "string" },
      code: { type: "string" },
    },
  },
  ChannelVersionInput: {
    type: "object",
    additionalProperties: false,
    properties: {
      expectedVersion: { type: "integer", minimum: 1 },
    },
  },
  ChannelCreateInput: {
    type: "object",
    additionalProperties: false,
    required: ["name", "operationKey"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 60 },
      description: { type: "string", maxLength: 160 },
      topic: { type: "string", maxLength: 250 },
      visibility: { type: "string", enum: [...channelVisibilities] },
      kind: { type: "string", enum: [...channelKinds] },
      operationKey: {
        type: "string",
        pattern: "^[a-z0-9][a-z0-9-]{5,79}$",
        description:
          "Stable semantic key reused when retrying the same create request",
      },
      agentIds: {
        type: "array",
        maxItems: 20,
        items: { type: "string", maxLength: 80 },
      },
      members: {
        type: "array",
        maxItems: 20,
        items: { $ref: "#/components/schemas/ChannelMemberReference" },
      },
      workstream: { $ref: "#/components/schemas/ChannelWorkstreamInput" },
    },
  },
  ChannelUpdateInput: {
    type: "object",
    additionalProperties: false,
    properties: {
      expectedVersion: { type: "integer", minimum: 1 },
      name: { type: "string", minLength: 1, maxLength: 60 },
      description: { type: "string", maxLength: 160 },
      topic: { type: "string", maxLength: 250 },
      workstream: { $ref: "#/components/schemas/ChannelWorkstreamInput" },
    },
  },
  ChannelWorkstreamInput: {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: [...channelWorkstreamStatuses] },
      repository: { type: "string", maxLength: 500 },
      baseBranch: { type: "string", maxLength: 160 },
      branch: { type: "string", maxLength: 160 },
      pullRequestUrls: {
        type: "array",
        maxItems: 20,
        items: { type: "string", format: "uri", maxLength: 1000 },
      },
    },
  },
  ChannelMembersAddInput: {
    type: "object",
    additionalProperties: false,
    required: ["members"],
    properties: {
      expectedVersion: { type: "integer", minimum: 1 },
      idempotencyKey: { type: "string", minLength: 1, maxLength: 120 },
      members: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: { $ref: "#/components/schemas/ChannelMemberReference" },
      },
    },
  },
  ChannelMemberReference: {
    type: "object",
    additionalProperties: false,
    required: ["type", "id"],
    properties: {
      type: { type: "string", enum: ["user", "agent"] },
      id: { type: "string", maxLength: 120 },
    },
  },
  ChannelDeletionRequestInput: {
    type: "object",
    additionalProperties: false,
    required: ["reason"],
    properties: {
      reason: { type: "string", minLength: 20, maxLength: 1000 },
    },
  },
  ChannelPolicyInput: {
    type: "object",
    additionalProperties: false,
    properties: {
      agentPermissions: {
        type: "array",
        uniqueItems: true,
        items: { type: "string", enum: [...channelAgentPermissions] },
      },
    },
  },
} as const;
