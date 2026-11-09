import type { JsonObject, McpConnectionCreate } from "@chief/relay-contracts";
import {
  automationToolCatalogSchema,
  mcpCatalogToolsSchema,
  mcpConnectionAccessSchema,
  mcpConnectionAuthorizeResultSchema,
  mcpConnectionListSchema,
  mcpConnectionSchema,
  mcpToolCallResultSchema,
  workspaceScheduleDeleteResultSchema,
} from "@chief/relay-contracts";

import type { RelayClientOptions } from "./relay-client-options";
import { RelayClientBase } from "./relay-client-base";
import { RelayClientError } from "./relay-client-error";

/** A relay from before plugins answers every plugin route with a generic 404. */
async function explainMissingRoute<T>(request: Promise<T>) {
  try {
    return await request;
  } catch (error) {
    if (
      error instanceof RelayClientError &&
      error.status === 404 &&
      error.code === "not_found"
    )
      throw new RelayClientError(
        "This relay doesn't support plugins or automation steps yet. Update the relay, then try again.",
        404,
        "relay_outdated",
      );
    throw error;
  }
}

/** The workspace's plugins: remote MCP servers connected in the relay. */
export class RelayPluginsClient extends RelayClientBase {
  constructor(options: RelayClientOptions) {
    super(options);
  }

  private pluginUrl(id?: string, action?: string) {
    return this.workspaceUrl(
      ["plugins", id && encodeURIComponent(id), action]
        .filter(Boolean)
        .join("/"),
    );
  }

  /** Where providers send people back after signing in; shown when an app must be registered by hand. */
  oauthCallbackUrl() {
    return `${this.relayUrl}/mcp/oauth/callback`;
  }

  async list() {
    return (
      await explainMissingRoute(
        this.fetchJson(this.pluginUrl(), mcpConnectionListSchema),
      )
    ).connections;
  }

  create(input: McpConnectionCreate) {
    return this.fetchJson(this.pluginUrl(), mcpConnectionSchema, true, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  remove(id: string) {
    return this.fetchJson(
      this.pluginUrl(id),
      workspaceScheduleDeleteResultSchema,
      true,
      { method: "DELETE" },
    );
  }

  authorize(id: string) {
    return this.fetchJson(
      this.pluginUrl(id, "authorize"),
      mcpConnectionAuthorizeResultSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
  }

  configureClient(
    id: string,
    input: { clientId: string; clientSecret?: string },
  ) {
    return this.fetchJson(
      this.pluginUrl(id, "client"),
      mcpConnectionAuthorizeResultSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  }

  /** Swaps a key-only plugin's headers; the relay keeps the old ones if the server rejects the new. */
  replaceHeaders(id: string, headers: { name: string; value: string }[]) {
    return this.fetchJson(
      this.pluginUrl(id, "headers"),
      mcpConnectionSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ headers }),
      },
    );
  }

  access(id: string) {
    return this.fetchJson(
      this.pluginUrl(id, "access"),
      mcpConnectionAccessSchema,
    );
  }

  setAccess(id: string, agentIds: string[], enabled: boolean) {
    return this.fetchJson(
      this.pluginUrl(id, "access"),
      mcpConnectionAccessSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentIds, enabled }),
      },
    );
  }

  refresh(id: string) {
    return this.fetchJson(
      this.pluginUrl(id, "refresh"),
      mcpConnectionSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
  }

  /** For agents running outside the relay; people cannot call plugin tools. */
  callTool(id: string, name: string, args: JsonObject) {
    return this.fetchJson(
      this.pluginUrl(id, "tools/call"),
      mcpToolCallResultSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, arguments: args }),
      },
    );
  }

  /** Chief's own tools that automations can use as steps. */
  /** A catalog plugin's tools before it is connected; empty when unknown. */
  async catalogTools(domain: string) {
    return (
      await this.fetchJson(
        `${this.workspaceUrl("plugin-tools")}?domain=${encodeURIComponent(domain)}`,
        mcpCatalogToolsSchema,
      )
    ).tools;
  }

  async automationTools() {
    return (
      await explainMissingRoute(
        this.fetchJson(
          this.workspaceUrl("automation-tools"),
          automationToolCatalogSchema,
        ),
      )
    ).tools;
  }
}
