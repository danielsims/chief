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
} from "./workspace-data";

export const workspaceDataOpenApiPaths = {
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
