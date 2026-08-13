export function pluginOpenApiPaths(
  body: (schema: string) => Record<string, unknown>,
) {
  const pluginId = {
    name: "pluginId",
    in: "path",
    required: true,
    schema: {
      type: "string",
      pattern: "^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$",
    },
  };
  const response = {
    "200": {
      description: "Plugin operation result",
      content: {
        "application/json": {
          schema: { type: "object", additionalProperties: true },
        },
      },
    },
  };
  return {
    "/local-tools/plugins": {
      get: {
        operationId: "plugins.list",
        summary: "List available and installed plugins",
        parameters: [
          {
            name: "query",
            in: "query",
            schema: { type: "string", maxLength: 120 },
            description:
              "Service name or capability to find, such as PostHog or calendar.",
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 20, default: 8 },
          },
        ],
        responses: response,
      },
    },
    "/local-tools/plugins/{pluginId}/install": {
      post: {
        operationId: "plugins.install",
        summary: "Install a plugin",
        parameters: [pluginId],
        requestBody: body("PluginInstallInput"),
        responses: response,
      },
    },
    "/local-tools/plugins/{pluginId}/authorize": {
      post: {
        operationId: "plugins.authorize",
        summary: "Request user authorization for a plugin",
        parameters: [pluginId],
        responses: response,
      },
    },
    "/local-tools/plugins/{pluginId}": {
      delete: {
        operationId: "plugins.uninstall",
        summary: "Uninstall a plugin",
        parameters: [pluginId],
        responses: response,
      },
    },
  };
}

export const pluginOpenApiSchemas = {
  PluginInstallInput: {
    type: "object",
    additionalProperties: false,
    properties: {
      trusted: {
        type: "boolean",
        description:
          "Explicitly trust this package's MCP servers. Installing alone never implies trust.",
      },
    },
  },
} as const;
