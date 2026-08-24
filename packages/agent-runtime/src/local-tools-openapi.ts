import { workspaceToolRouter } from "./tools/local/index.js";

export type {
  LocalToolOpenApiOperation,
  LocalToolOpenApiPath,
} from "./tools/local/router.js";

export function localToolsOpenApi(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Chief Local Workspace Tools",
      version: "1.0.0",
      description:
        "Private runtime-local capabilities composed for Chief workspace agents.",
    },
    servers: [{ url: origin }],
    security: [{ localWorkspaceCapability: [] }],
    paths: workspaceToolRouter.paths(),
    components: {
      securitySchemes: {
        localWorkspaceCapability: { type: "http", scheme: "bearer" },
      },
    },
  };
}
