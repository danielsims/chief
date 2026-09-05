import {
  errorResponse,
  jsonResponse,
  jsonSchema,
  pathParameter,
} from "./openapi-helpers";
import {
  relayProjectCreateSchema,
  relayProjectDeleteResultSchema,
  relayProjectSchema,
  relayProjectsResultSchema,
} from "./projects";
import {
  workspaceFileSaveSchema,
  workspaceFileSchema,
  workspaceFilesResultSchema,
  workspaceFileUpdateSchema,
  workspaceMediaUploadSchema,
} from "./workspace-data";

export const workspaceDataOpenApiPaths = {
  "/v1/workspaces/{workspaceId}/agents/{agentId}/artifacts": {
    post: {
      operationId: "publishWorkspaceAsset",
      description:
        "Publish a file up to 8 MB as this agent. Files inherit their source conversation's access rules.",
      parameters: [pathParameter("workspaceId"), pathParameter("agentId")],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: jsonSchema(workspaceMediaUploadSchema),
          },
        },
      },
      responses: {
        "201": jsonResponse(
          "The published workspace file.",
          workspaceFileSchema,
        ),
        "400": errorResponse,
        "401": errorResponse,
        "403": errorResponse,
        "413": errorResponse,
      },
    },
  },
  "/v1/workspaces/{workspaceId}/agents/{agentId}/artifacts/{artifactId}": {
    get: {
      operationId: "downloadWorkspaceAsset",
      parameters: [
        pathParameter("workspaceId"),
        pathParameter("agentId"),
        pathParameter("artifactId"),
      ],
      responses: {
        "200": {
          description:
            "The file bytes with their original content type, as an attachment.",
          content: {
            "application/octet-stream": {
              schema: { type: "string", format: "binary" },
            },
          },
        },
        "401": errorResponse,
        "403": errorResponse,
        "404": errorResponse,
      },
    },
  },
  "/v1/workspaces/{workspaceId}/files": {
    get: {
      operationId: "listWorkspaceFiles",
      parameters: [pathParameter("workspaceId")],
      responses: {
        "200": jsonResponse(
          "Versioned files shared through the workspace relay.",
          workspaceFilesResultSchema,
        ),
        "401": errorResponse,
        "403": errorResponse,
      },
    },
    post: {
      operationId: "saveWorkspaceFile",
      parameters: [pathParameter("workspaceId")],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: jsonSchema(workspaceFileSaveSchema) },
        },
      },
      responses: {
        "200": jsonResponse("The updated workspace file.", workspaceFileSchema),
        "201": jsonResponse("The created workspace file.", workspaceFileSchema),
        "400": errorResponse,
        "401": errorResponse,
        "403": errorResponse,
        "409": errorResponse,
      },
    },
  },
  "/v1/workspaces/{workspaceId}/files/{fileId}": {
    put: {
      operationId: "updateWorkspaceFile",
      parameters: [pathParameter("workspaceId"), pathParameter("fileId")],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: jsonSchema(workspaceFileUpdateSchema),
          },
        },
      },
      responses: {
        "200": jsonResponse("The updated workspace file.", workspaceFileSchema),
        "400": errorResponse,
        "401": errorResponse,
        "403": errorResponse,
        "404": errorResponse,
        "409": errorResponse,
      },
    },
  },
  "/v1/workspaces/{workspaceId}/projects": {
    get: {
      operationId: "listProjects",
      parameters: [pathParameter("workspaceId")],
      responses: {
        "200": jsonResponse(
          "Workspace project registry metadata.",
          relayProjectsResultSchema,
        ),
        "401": errorResponse,
        "403": errorResponse,
      },
    },
    post: {
      operationId: "createProject",
      parameters: [pathParameter("workspaceId")],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: jsonSchema(relayProjectCreateSchema) },
        },
      },
      responses: {
        "201": jsonResponse("The registered project.", relayProjectSchema),
        "400": errorResponse,
        "401": errorResponse,
        "403": errorResponse,
        "409": errorResponse,
      },
    },
  },
  "/v1/workspaces/{workspaceId}/projects/{projectId}": {
    delete: {
      operationId: "deleteProject",
      parameters: [pathParameter("workspaceId"), pathParameter("projectId")],
      responses: {
        "200": jsonResponse(
          "The removed project registry entry.",
          relayProjectDeleteResultSchema,
        ),
        "401": errorResponse,
        "403": errorResponse,
        "404": errorResponse,
      },
    },
  },
} as const;
