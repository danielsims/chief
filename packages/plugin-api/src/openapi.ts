export function pluginOpenApiPaths(
  body: (schema: string) => Record<string, unknown>,
) {
  const channelId = {
    name: "channelId",
    in: "path",
    required: true,
    schema: { type: "string" },
  };
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
    "/local-tools/channels/{channelId}/plugins/recommend": {
      post: {
        operationId: "plugins.recommend",
        summary: "Recommend plugins in a conversation",
        description:
          "Resolves real catalog plugins and publishes durable, actionable plugin cards in the specified channel, thread, or direct message. This does not install or authorize a plugin.",
        parameters: [channelId],
        requestBody: body("PluginRecommendationInput"),
        responses: response,
      },
    },
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
  PluginRecommendationInput: {
    type: "object",
    additionalProperties: false,
    required: ["content", "idempotencyKey"],
    anyOf: [{ required: ["pluginIds"] }, { required: ["services"] }],
    properties: {
      content: {
        type: "string",
        minLength: 1,
        maxLength: 1000,
        description: "Short conversational context shown above the cards.",
      },
      pluginIds: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: { type: "string", minLength: 1, maxLength: 120 },
        description: "Exact catalog plugin ids when already known.",
      },
      services: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: { type: "string", minLength: 1, maxLength: 120 },
        description:
          "Service names or capabilities to resolve against the live catalog, in display order.",
      },
      threadRootId: {
        type: "string",
        maxLength: 160,
        description: "Post the recommendation inside this existing thread.",
      },
      idempotencyKey: {
        type: "string",
        minLength: 1,
        maxLength: 120,
        description: "Stable key that prevents duplicate recommendation cards.",
      },
    },
  },
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
