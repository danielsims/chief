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
    tags: [
      {
        name: "Health & discovery",
        description: "Liveness and protocol metadata.",
      },
      {
        name: "Workspaces",
        description: "Provision, select and bootstrap a workspace.",
      },
      {
        name: "Invites & members",
        description: "Invite people and manage workspace membership.",
      },
      {
        name: "Channels",
        description: "Create, join and administer workspace channels.",
      },
      {
        name: "Messages",
        description: "Read, send, edit and delete durable messages.",
      },
      {
        name: "Reactions",
        description: "Add, list and remove message reactions.",
      },
      {
        name: "Attachments",
        description: "Store and fetch message attachments.",
      },
      {
        name: "Files",
        description: "Versioned files shared through the workspace.",
      },
      {
        name: "Projects",
        description: "Workspace project registry metadata.",
      },
      {
        name: "Logs",
        description: "Retained, redacted operational logs.",
      },
      {
        name: "Agents",
        description: "Files published by workspace agents.",
      },
    ],
    security: [{ nostrNip98: [] }],
    paths: {
      ...coreOpenApiPaths,
      ...workspaceDataOpenApiPaths,
      "/v1/workspaces/{workspaceId}/invites": {
        post: {
          operationId: "createWorkspaceInvite",
          summary: "Create an invite link",
          description:
            "Mints a single-use invite secret for the workspace, optionally scoped to a channel.",
          tags: ["Invites & members"],
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
          summary: "Preview an invite",
          description:
            "Returns the workspace and channel an invite reveals, without claiming it.",
          tags: ["Invites & members"],
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
          summary: "Claim an invite",
          description:
            "Redeems an invite secret and joins the authenticated account to the workspace.",
          tags: ["Invites & members"],
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
          summary: "List workspace members",
          description:
            "Returns the human, agent and service members of the workspace with their roles.",
          tags: ["Invites & members"],
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
          summary: "Create a channel",
          tags: ["Channels"],
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
          summary: "Get a channel",
          description: "Returns the channel and its members.",
          tags: ["Channels"],
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
          summary: "Update a channel",
          description: "Renames a channel or changes its visibility.",
          tags: ["Channels"],
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
          summary: "Archive a channel",
          tags: ["Channels"],
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
          summary: "Restore a channel",
          tags: ["Channels"],
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
          summary: "Join a channel",
          description: "Adds the calling principal to the channel.",
          tags: ["Channels"],
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
          summary: "Leave a channel",
          description: "Removes the calling principal from the channel.",
          tags: ["Channels"],
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
          summary: "List channel members",
          description: "Returns the channel membership with best-effort names.",
          tags: ["Channels"],
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
          summary: "Add channel members",
          description: "Adds one or more workspace members to the channel.",
          tags: ["Channels"],
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
          summary: "Remove a channel member",
          tags: ["Channels"],
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
