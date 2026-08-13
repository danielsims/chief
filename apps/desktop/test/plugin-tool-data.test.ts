import assert from "node:assert/strict";
import test from "node:test";

import {
  isPluginTool,
  pluginAuthorizationFromResult,
  pluginListFromResult,
} from "../src/components/chat/plugin-tool-data";

void test("recognizes plugin API tools across MCP name formats", () => {
  assert.equal(isPluginTool("mcp__chief__pluginsAuthorize"), true);
  assert.equal(isPluginTool("localTools.pluginsList"), true);
  assert.equal(isPluginTool("channelsList"), false);
});

void test("parses a safe structured plugin authorization action", () => {
  const action = pluginAuthorizationFromResult({
    type: "tool_result",
    tool_use_id: "tool-1",
    content: JSON.stringify({
      kind: "plugin_authorization",
      pluginId: "posthog",
      pluginName: "PostHog",
      description: "Product analytics",
      provider: "posthog.com",
      authorizationUrl: "https://us.posthog.com/oauth/authorize",
      status: "authorization_required",
    }),
  });
  assert.equal(action?.pluginId, "posthog");
});

void test("rejects an unsafe authorization URL", () => {
  const action = pluginAuthorizationFromResult({
    type: "tool_result",
    tool_use_id: "tool-1",
    content: JSON.stringify({
      kind: "plugin_authorization",
      pluginId: "posthog",
      pluginName: "PostHog",
      description: "Product analytics",
      provider: "posthog.com",
      authorizationUrl: "javascript:alert(1)",
      status: "authorization_required",
    }),
  });
  assert.equal(action, undefined);
});

void test("parses plugin list results", () => {
  const plugins = pluginListFromResult({
    type: "tool_result",
    tool_use_id: "tool-2",
    content: [
      {
        type: "text",
        text: JSON.stringify({
          plugins: [
            {
              id: "notion",
              name: "Notion",
              description: "Workspace",
              category: "productivity",
              source: {
                type: "discovery",
                registry: "integrations.sh",
                domain: "notion.com",
              },
              status: "available",
              enabled: false,
              trusted: false,
            },
          ],
        }),
      },
    ],
  });
  assert.equal(plugins?.[0]?.name, "Notion");
});
