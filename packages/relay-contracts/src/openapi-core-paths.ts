import {
  attachmentUploadPayloadSchema,
  attachmentUploadResultSchema,
} from "./attachments";
import { logBatchSchema, logPageSchema, logReceiptSchema } from "./logs";
import {
  appendMessageCommandSchema,
  appendMessageResultSchema,
  conversationEventPageSchema,
  deleteMessageResultSchema,
  editMessageCommandSchema,
  editMessageResultSchema,
  messagePageSchema,
  messageReactionsResultSchema,
  reactToMessagePayloadSchema,
  reactToMessageResultSchema,
  socketTicketSchema,
} from "./messages";
import {
  errorResponse,
  jsonResponse,
  jsonSchema,
  pathParameter,
} from "./openapi-helpers";
import {
  claimedWorkspaceSchema,
  claimWorkspaceCommandSchema,
  provisionWorkspaceCommandSchema,
  workspaceSnapshotSchema,
} from "./workspaces";

export const coreOpenApiPaths = {
  "/health": {
    get: {
      operationId: "relayHealth",
      summary: "Check relay health",
      description:
        "Liveness probe used by clients and deployments before issuing requests.",
      tags: ["Health & discovery"],
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
      summary: "Create a workspace",
      description:
        "Provisions a workspace owned by the authenticated account and enqueues its initial setup.",
      tags: ["Workspaces"],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: jsonSchema(provisionWorkspaceCommandSchema),
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
      summary: "Get the active workspace",
      description:
        "Returns the caller's active workspace snapshot, or 204 when none is selected.",
      tags: ["Workspaces"],
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
      summary: "List messages",
      description:
        "Returns a page of durable messages after an optional sequence cursor.",
      tags: ["Messages"],
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
        "200": jsonResponse("A page of durable messages.", messagePageSchema),
        "401": errorResponse,
        "403": errorResponse,
      },
    },
    post: {
      operationId: "appendConversationMessage",
      summary: "Send a message",
      description:
        "Appends a message with the given command id. Replaying the same command id returns the original result.",
      tags: ["Messages"],
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
      summary: "Claim a workspace",
      description:
        "Claims an unclaimed relay workspace for its first owner using the bootstrap token.",
      tags: ["Workspaces"],
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
      summary: "List workspace logs",
      description:
        "Returns a cursor-paged slice of retained, redacted workspace logs.",
      tags: ["Logs"],
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
      summary: "Record workspace logs",
      description:
        "Stores a batch of redacted log records. Duplicate command ids are accepted idempotently.",
      tags: ["Logs"],
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
      summary: "Catch up on conversation events",
      description:
        "Catch up from the last durable sequence before opening the live WebSocket stream.",
      tags: ["Messages"],
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
        summary: "Mint a live socket ticket",
        description:
          "Mints a short-lived, one-use ticket for the live WebSocket endpoint without placing an access token in its URL.",
        tags: ["Messages"],
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
        summary: "Edit a message",
        parameters: [
          pathParameter("workspaceId"),
          pathParameter("conversationId"),
          pathParameter("messageId"),
        ],
        tags: ["Messages"],
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
        summary: "Delete a message",
        description: "Soft-deletes the message and returns its tombstone.",
        tags: ["Messages"],
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
  "/v1/workspaces/{workspaceId}/conversations/{conversationId}/messages/{messageId}/reactions":
    {
      get: {
        operationId: "listMessageReactions",
        summary: "List reactions",
        description: "Returns the durable reactions folded onto this message.",
        tags: ["Reactions"],
        parameters: [
          pathParameter("workspaceId"),
          pathParameter("conversationId"),
          pathParameter("messageId"),
        ],
        responses: {
          "200": jsonResponse(
            "The durable reactions folded onto this message.",
            messageReactionsResultSchema,
          ),
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
        },
      },
      post: {
        operationId: "addMessageReaction",
        summary: "Add a reaction",
        tags: ["Reactions"],
        parameters: [
          pathParameter("workspaceId"),
          pathParameter("conversationId"),
          pathParameter("messageId"),
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: jsonSchema(reactToMessagePayloadSchema),
            },
          },
        },
        responses: {
          "200": jsonResponse(
            "The message with its durable reaction aggregate.",
            reactToMessageResultSchema,
          ),
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
          "409": errorResponse,
        },
      },
      delete: {
        operationId: "removeMessageReaction",
        summary: "Remove a reaction",
        tags: ["Reactions"],
        parameters: [
          pathParameter("workspaceId"),
          pathParameter("conversationId"),
          pathParameter("messageId"),
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: jsonSchema(reactToMessagePayloadSchema),
            },
          },
        },
        responses: {
          "200": jsonResponse(
            "The message after removing the durable reaction.",
            reactToMessageResultSchema,
          ),
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
          "409": errorResponse,
        },
      },
    },
  "/v1/workspaces/{workspaceId}/conversations/{conversationId}/attachments": {
    post: {
      operationId: "uploadAttachment",
      summary: "Upload an attachment",
      description:
        "Stores base64 file bytes in the conversation and returns their public URL and key.",
      tags: ["Attachments"],
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
      summary: "Download an attachment",
      description:
        "Returns the stored attachment bytes with their content type.",
      tags: ["Attachments"],
      security: [],
      parameters: [pathParameter("key")],
      responses: {
        "200": { description: "The attachment bytes with its media type." },
        "404": errorResponse,
      },
    },
  },
} as const;
