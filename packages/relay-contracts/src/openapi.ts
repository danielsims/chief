import { z } from "zod";

import { relayDiscoverySchema } from "./discovery";
import { relayErrorSchema } from "./envelopes";
import { logBatchSchema, logPageSchema, logReceiptSchema } from "./logs";
import {
  appendMessageCommandSchema,
  appendMessageResultSchema,
  conversationEventPageSchema,
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
