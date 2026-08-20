import { z } from "zod";

import {
  attachmentUploadPayloadSchema,
  attachmentUploadResultSchema,
} from "./attachments";
import {
  channelActionResultSchema,
  channelArchiveCommandSchema,
  channelCreateCommandSchema,
  channelDetailSchema,
  channelJoinCommandSchema,
  channelLeaveCommandSchema,
  channelListResultSchema,
  channelMemberAddCommandSchema,
  channelMemberRemoveCommandSchema,
  channelMembersResultSchema,
  channelRecordSchema,
  channelUnarchiveCommandSchema,
  channelUpdateCommandSchema,
} from "./channels";
import { relayDiscoverySchema } from "./discovery";
import { relayErrorSchema } from "./envelopes";
import { logBatchSchema, logPageSchema, logReceiptSchema } from "./logs";
import {
  appendMessageCommandSchema,
  appendMessageResultSchema,
  conversationEventPageSchema,
  deleteMessageCommandSchema,
  deleteMessageResultSchema,
  editMessageCommandSchema,
  editMessageResultSchema,
  messagePageSchema,
  socketTicketSchema,
} from "./messages";
import {
  claimedWorkspaceSchema,
  claimWorkspaceCommandSchema,
  createWorkspaceCommandSchema,
  workspaceSnapshotSchema,
} from "./workspaces";

function jsonSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, { target: "draft-2020-12" });
}

const errorResponse = {
  description: "The command could not be completed.",
  content: {
    "application/json": {
      schema: jsonSchema(relayErrorSchema),
    },
  },
};

export function createRelayOpenApiDocument(origin: string) {
  const baseUrl = new URL(origin);
  baseUrl.pathname = "/";

  return {
    openapi: "3.1.0",
    info: {
      title: "Chief Relay API",
      version: "1.0.0",
      description:
        "The versioned protocol used by Chief clients, durable agents, and relay deployments.",
    },
    servers: [{ url: baseUrl.toString().replace(/\/$/u, "") }],
    security: [{ bearerAuth: [] }],
    paths: {
      "/health": {
        get: {
          operationId: "relayHealth",
          security: [],
          responses: {
            "200": {
              description: "Relay is accepting requests.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["ok", "protocolVersion"],
                    properties: {
                      ok: { const: true },
                      protocolVersion: { const: 1 },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/v1/workspaces": {
        post: {
          operationId: "createWorkspace",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: jsonSchema(createWorkspaceCommandSchema),
              },
            },
          },
          responses: {
            "200": jsonResponse(
              "The workspace and its initial Chief setup job.",
              workspaceSnapshotSchema,
            ),
            "400": errorResponse,
            "401": errorResponse,
            "403": errorResponse,
          },
        },
      },
      "/v1/me/workspace": {
        get: {
          operationId: "getActiveWorkspace",
          responses: {
            "200": jsonResponse(
              "The user's active workspace.",
              workspaceSnapshotSchema,
            ),
            "204": { description: "The user has no workspace yet." },
            "401": errorResponse,
          },
        },
      },
      "/v1/workspaces/{workspaceId}/conversations/{conversationId}/messages": {
        get: {
          operationId: "listConversationMessages",
          parameters: [
            pathParameter("workspaceId"),
            pathParameter("conversationId"),
            {
              name: "after",
              in: "query",
              schema: { type: "integer", minimum: 0 },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 200 },
            },
          ],
          responses: {
            "200": jsonResponse(
              "A page of durable messages.",
              messagePageSchema,
            ),
            "401": errorResponse,
            "403": errorResponse,
          },
        },
        post: {
          operationId: "appendConversationMessage",
          parameters: [
            pathParameter("workspaceId"),
            pathParameter("conversationId"),
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: jsonSchema(appendMessageCommandSchema),
              },
            },
          },
          responses: {
            "200": jsonResponse(
              "The persisted message. Duplicate command ids return the original result.",
              appendMessageResultSchema,
            ),
            "400": errorResponse,
            "401": errorResponse,
            "403": errorResponse,
            "409": errorResponse,
          },
        },
      },
      "/v1/workspaces/{workspaceId}/bootstrap/claim": {
        post: {
          operationId: "claimWorkspace",
          parameters: [pathParameter("workspaceId")],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: jsonSchema(claimWorkspaceCommandSchema),
              },
            },
          },
          responses: {
            "201": jsonResponse(
              "The relay workspace was claimed by its first owner.",
              claimedWorkspaceSchema,
            ),
            "400": errorResponse,
            "401": errorResponse,
            "403": errorResponse,
            "409": errorResponse,
          },
        },
      },
      "/v1/workspaces/{workspaceId}/logs": {
        get: {
          operationId: "listWorkspaceLogs",
          parameters: [
            pathParameter("workspaceId"),
            {
              name: "cursor",
              in: "query",
              schema: { type: "integer", minimum: 1 },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 200 },
            },
          ],
          responses: {
            "200": jsonResponse("A page of workspace logs.", logPageSchema),
            "401": errorResponse,
            "403": errorResponse,
          },
        },
        post: {
          operationId: "recordWorkspaceLogs",
          parameters: [pathParameter("workspaceId")],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: jsonSchema(logBatchSchema) },
            },
          },
          responses: {
            "200": jsonResponse(
              "The log batch was accepted idempotently.",
              logReceiptSchema,
            ),
            "400": errorResponse,
            "401": errorResponse,
            "403": errorResponse,
            "409": errorResponse,
          },
        },
      },
      "/v1/workspaces/{workspaceId}/conversations/{conversationId}/events": {
        get: {
          operationId: "listConversationEvents",
          description:
            "Catch up from the last durable sequence before opening the live WebSocket stream.",
          parameters: [
            pathParameter("workspaceId"),
            pathParameter("conversationId"),
            {
              name: "after",
              in: "query",
              schema: { type: "integer", minimum: 0 },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 200 },
            },
          ],
          responses: {
            "200": jsonResponse(
              "An ordered page of durable conversation events.",
              conversationEventPageSchema,
            ),
            "401": errorResponse,
            "403": errorResponse,
          },
        },
      },
      "/v1/workspaces/{workspaceId}/conversations/{conversationId}/socket-tickets":
        {
          post: {
            operationId: "createConversationSocketTicket",
            description:
              "Mints a short-lived, one-use ticket for the live WebSocket endpoint without placing an access token in its URL.",
            parameters: [
              pathParameter("workspaceId"),
              pathParameter("conversationId"),
            ],
            responses: {
              "201": jsonResponse(
                "A conversation-scoped WebSocket ticket.",
                socketTicketSchema,
              ),
              "401": errorResponse,
              "403": errorResponse,
            },
          },
        },
      "/v1/workspaces/{workspaceId}/conversations/{conversationId}/messages/{messageId}/edit":
        {
          post: {
            operationId: "editConversationMessage",
            parameters: [
              pathParameter("workspaceId"),
              pathParameter("conversationId"),
              pathParameter("messageId"),
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: jsonSchema(editMessageCommandSchema),
                },
              },
            },
            responses: {
              "200": jsonResponse(
                "The message with its edited body and flag.",
                editMessageResultSchema,
              ),
              "400": errorResponse,
              "401": errorResponse,
              "403": errorResponse,
              "404": errorResponse,
              "409": errorResponse,
            },
          },
        },
      "/v1/workspaces/{workspaceId}/conversations/{conversationId}/messages/{messageId}":
        {
          delete: {
            operationId: "deleteConversationMessage",
            parameters: [
              pathParameter("workspaceId"),
              pathParameter("conversationId"),
              pathParameter("messageId"),
            ],
            responses: {
              "200": jsonResponse(
                "The deleted message tombstone.",
                deleteMessageResultSchema,
              ),
              "401": errorResponse,
              "403": errorResponse,
              "404": errorResponse,
            },
          },
        },
      "/v1/workspaces/{workspaceId}/conversations/{conversationId}/attachments":
        {
          post: {
            operationId: "uploadAttachment",
            parameters: [
              pathParameter("workspaceId"),
              pathParameter("conversationId"),
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: jsonSchema(attachmentUploadPayloadSchema),
                },
              },
            },
            responses: {
              "201": jsonResponse(
                "The stored attachment's public URL and key.",
                attachmentUploadResultSchema,
              ),
              "400": errorResponse,
              "401": errorResponse,
              "403": errorResponse,
              "413": errorResponse,
              "415": errorResponse,
            },
          },
        },
      "/v1/attachments/{key}": {
        get: {
          operationId: "getAttachment",
          security: [],
          parameters: [pathParameter("key")],
          responses: {
            "200": { description: "The attachment bytes with its media type." },
            "404": errorResponse,
          },
        },
      },
      "/v1/workspaces/{workspaceId}/channels": {
        get: {
          operationId: "listChannels",
          parameters: [pathParameter("workspaceId")],
          responses: {
            "200": jsonResponse(
              "The workspace channels, non-archived first.",
              channelListResultSchema,
            ),
            "401": errorResponse,
            "403": errorResponse,
          },
        },
        post: {
          operationId: "createChannel",
          parameters: [pathParameter("workspaceId")],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: jsonSchema(channelCreateCommandSchema),
              },
            },
          },
          responses: {
            "201": jsonResponse(
              "The created channel with its members.",
              channelDetailSchema,
            ),
            "400": errorResponse,
            "401": errorResponse,
            "403": errorResponse,
            "409": errorResponse,
          },
        },
      },
      "/v1/workspaces/{workspaceId}/channels/{conversationId}": {
        get: {
          operationId: "getChannel",
          parameters: [
            pathParameter("workspaceId"),
            pathParameter("conversationId"),
          ],
          responses: {
            "200": jsonResponse(
              "The channel with its members.",
              channelDetailSchema,
            ),
            "401": errorResponse,
            "403": errorResponse,
            "404": errorResponse,
          },
        },
      },
      "/v1/workspaces/{workspaceId}/channels/{conversationId}/update": {
        post: {
          operationId: "updateChannel",
          parameters: [
            pathParameter("workspaceId"),
            pathParameter("conversationId"),
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: jsonSchema(channelUpdateCommandSchema),
              },
            },
          },
          responses: {
            "200": jsonResponse(
              "The updated channel record.",
              channelListResultSchema,
            ),
            "400": errorResponse,
            "401": errorResponse,
            "403": errorResponse,
            "404": errorResponse,
          },
        },
      },
      "/v1/workspaces/{workspaceId}/channels/{conversationId}/archive": {
        post: {
          operationId: "archiveChannel",
          parameters: [
            pathParameter("workspaceId"),
            pathParameter("conversationId"),
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: jsonSchema(channelArchiveCommandSchema),
              },
            },
          },
          responses: {
            "200": jsonResponse("The archived channel.", channelRecordSchema),
            "401": errorResponse,
            "403": errorResponse,
            "404": errorResponse,
          },
        },
      },
      "/v1/workspaces/{workspaceId}/channels/{conversationId}/unarchive": {
        post: {
          operationId: "unarchiveChannel",
          parameters: [
            pathParameter("workspaceId"),
            pathParameter("conversationId"),
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: jsonSchema(channelUnarchiveCommandSchema),
              },
            },
          },
          responses: {
            "200": jsonResponse("The restored channel.", channelRecordSchema),
            "401": errorResponse,
            "403": errorResponse,
            "404": errorResponse,
          },
        },
      },
      "/v1/workspaces/{workspaceId}/channels/{conversationId}/join": {
        post: {
          operationId: "joinChannel",
          parameters: [
            pathParameter("workspaceId"),
            pathParameter("conversationId"),
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: jsonSchema(channelJoinCommandSchema),
              },
            },
          },
          responses: {
            "200": jsonResponse(
              "The actor joined the channel.",
              channelActionResultSchema,
            ),
            "401": errorResponse,
            "403": errorResponse,
            "404": errorResponse,
          },
        },
      },
      "/v1/workspaces/{workspaceId}/channels/{conversationId}/leave": {
        post: {
          operationId: "leaveChannel",
          parameters: [
            pathParameter("workspaceId"),
            pathParameter("conversationId"),
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: jsonSchema(channelLeaveCommandSchema),
              },
            },
          },
          responses: {
            "200": jsonResponse(
              "The actor left the channel.",
              channelActionResultSchema,
            ),
            "401": errorResponse,
            "403": errorResponse,
            "404": errorResponse,
          },
        },
      },
      "/v1/workspaces/{workspaceId}/channels/{conversationId}/members": {
        get: {
          operationId: "listChannelMembers",
          parameters: [
            pathParameter("workspaceId"),
            pathParameter("conversationId"),
          ],
          responses: {
            "200": jsonResponse(
              "The channel membership with best-effort names.",
              channelMembersResultSchema,
            ),
            "401": errorResponse,
            "403": errorResponse,
            "404": errorResponse,
          },
        },
      },
      "/v1/workspaces/{workspaceId}/channels/{conversationId}/members/add": {
        post: {
          operationId: "addChannelMember",
          parameters: [
            pathParameter("workspaceId"),
            pathParameter("conversationId"),
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: jsonSchema(channelMemberAddCommandSchema),
              },
            },
          },
          responses: {
            "200": jsonResponse(
              "The member was added.",
              channelActionResultSchema,
            ),
            "401": errorResponse,
            "403": errorResponse,
            "404": errorResponse,
          },
        },
      },
      "/v1/workspaces/{workspaceId}/channels/{conversationId}/members/remove": {
        post: {
          operationId: "removeChannelMember",
          parameters: [
            pathParameter("workspaceId"),
            pathParameter("conversationId"),
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: jsonSchema(channelMemberRemoveCommandSchema),
              },
            },
          },
          responses: {
            "200": jsonResponse(
              "The member was removed.",
              channelActionResultSchema,
            ),
            "401": errorResponse,
            "403": errorResponse,
            "404": errorResponse,
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        RelayDiscovery: jsonSchema(relayDiscoverySchema),
      },
    },
  } as const;
}

function pathParameter(name: string) {
  return {
    name,
    in: "path",
    required: true,
    schema: { type: "string", minLength: 1, maxLength: 128 },
  } as const;
}

function jsonResponse(description: string, schema: z.ZodType) {
  return {
    description,
    content: {
      "application/json": {
        schema: jsonSchema(schema),
      },
    },
  };
}

export type RelayOpenApiDocument = ReturnType<
  typeof createRelayOpenApiDocument
>;
