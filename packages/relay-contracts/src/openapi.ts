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
import { coreOpenApiPaths } from "./openapi-core-paths";
import {
  errorResponse,
  jsonResponse,
  jsonSchema,
  pathParameter,
} from "./openapi-helpers";
import { workspaceDataOpenApiPaths } from "./openapi-workspace-data-paths";
import {
  claimWorkspaceInviteCommandSchema,
  createWorkspaceInviteCommandSchema,
  previewWorkspaceInviteCommandSchema,
  updateWorkspaceMemberRoleCommandSchema,
  updateWorkspaceMemberRoleResultSchema,
  workspaceInviteClaimResultSchema,
  workspaceInviteSchema,
  workspaceMemberListSchema,
} from "./workspaces";

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
    security: [{ nostrNip98: [] }],
    paths: {
      ...coreOpenApiPaths,
      ...workspaceDataOpenApiPaths,
      "/v1/workspaces/{workspaceId}/invites": {
        post: {
          operationId: "createWorkspaceInvite",
          parameters: [pathParameter("workspaceId")],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: jsonSchema(createWorkspaceInviteCommandSchema),
              },
            },
          },
          responses: {
            "201": jsonResponse(
              "A single-use workspace invite.",
              workspaceInviteSchema,
            ),
            "401": errorResponse,
            "403": errorResponse,
            "409": errorResponse,
          },
        },
      },
      "/v1/workspaces/{workspaceId}/invites/preview": {
        post: {
          operationId: "previewWorkspaceInvite",
          security: [],
          parameters: [pathParameter("workspaceId")],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: jsonSchema(previewWorkspaceInviteCommandSchema),
              },
            },
          },
          responses: {
            "200": jsonResponse(
              "The workspace offered by this invite.",
              workspaceInviteSchema,
            ),
            "404": errorResponse,
            "410": errorResponse,
          },
        },
      },
      "/v1/workspaces/{workspaceId}/invites/claim": {
        post: {
          operationId: "claimWorkspaceInvite",
          parameters: [pathParameter("workspaceId")],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: jsonSchema(claimWorkspaceInviteCommandSchema),
              },
            },
          },
          responses: {
            "200": jsonResponse(
              "The joined workspace and optional channel.",
              workspaceInviteClaimResultSchema,
            ),
            "401": errorResponse,
            "403": errorResponse,
            "404": errorResponse,
            "410": errorResponse,
          },
        },
      },
      "/v1/workspaces/{workspaceId}/members": {
        get: {
          operationId: "listWorkspaceMembers",
          parameters: [pathParameter("workspaceId")],
          responses: {
            "200": jsonResponse(
              "The human, agent, and service members of the workspace.",
              workspaceMemberListSchema,
            ),
            "401": errorResponse,
            "403": errorResponse,
          },
        },
      },
      "/v1/workspaces/{workspaceId}/members/{kind}/{principalId}/role": {
        patch: {
          operationId: "updateWorkspaceMemberRole",
          parameters: [
            pathParameter("workspaceId"),
            pathParameter("kind"),
            pathParameter("principalId"),
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: jsonSchema(updateWorkspaceMemberRoleCommandSchema),
              },
            },
          },
          responses: {
            "200": jsonResponse(
              "The team member with its updated workspace role.",
              updateWorkspaceMemberRoleResultSchema,
            ),
            "400": errorResponse,
            "401": errorResponse,
            "403": errorResponse,
            "404": errorResponse,
            "409": errorResponse,
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
        nostrNip98: {
          type: "apiKey",
          in: "header",
          name: "Authorization",
          description:
            "A NIP-98 Nostr authorization event signed by this device or agent identity.",
        },
      },
      schemas: {
        RelayDiscovery: jsonSchema(relayDiscoverySchema),
      },
    },
  } as const;
}

export type RelayOpenApiDocument = ReturnType<
  typeof createRelayOpenApiDocument
>;
