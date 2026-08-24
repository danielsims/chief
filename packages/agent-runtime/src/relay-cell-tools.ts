import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { AgentConfig, JsonObject } from "@chief/relay-contracts";
import { AgentBrowserSession } from "@chief/browser/node";
import { createNip98Authorization, RelayClient } from "@chief/relay-client";
import {
  agentConfigSchema,
  appendMessageCommandSchema,
  parseJsonNumber,
  parseJsonObject,
  parseJsonString,
} from "@chief/relay-contracts";

import { cellToolDiagnostic } from "./relay-cell-diagnostics.js";
import { startRelayCellMcpHttpTransport } from "./relay-cell-http-server.js";
import { callPluginTool } from "./relay-cell-plugin-tools.js";
import {
  relayCellToolDefinitions as toolDefinitions,
  relayCellToolRequirements as toolRequirements,
} from "./relay-cell-tool-definitions.js";

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function parseConfig(): AgentConfig {
  return agentConfigSchema.parse(
    JSON.parse(requiredEnvironment("CHIEF_AGENT_CONFIG")),
  );
}

function relayClient() {
  const relayUrl = requiredEnvironment("CHIEF_RELAY_URL");
  const secretKey = requiredEnvironment("CHIEF_AGENT_SECRET_KEY");
  return new RelayClient({
    relayUrl,
    workspaceId: requiredEnvironment("CHIEF_WORKSPACE_ID"),
    getAuthorization: (request) =>
      Promise.resolve(createNip98Authorization(secretKey, request)),
  });
}

export const relayCellToolNames = Object.keys(toolRequirements);

function object<Input>(value: Input): JsonObject {
  return parseJsonObject(value) ?? {};
}

function string(input: JsonObject, key: string) {
  const value = input[key];
  const parsed = parseJsonString(value)?.trim();
  if (!parsed) {
    throw new Error(`${key} is required.`);
  }
  return parsed;
}

function optionalString(input: JsonObject, key: string) {
  const value = input[key];
  const parsed = parseJsonString(value)?.trim();
  return parsed === "" ? undefined : parsed;
}

function inferredMentions(body: string) {
  const identities: Record<string, string> = {
    chief: "chief",
    setup: "setup",
    marketer: "brand",
    content: "content",
    engineer: "engineer",
    analyst: "analyst",
    prospector: "prospector",
    advertising: "ads",
  };
  return [...body.matchAll(/@([A-Za-z][A-Za-z0-9_-]*)/gu)].flatMap((match) => {
    const id = identities[(match[1] ?? "").toLowerCase()];
    return id ? [id] : [];
  });
}

let browser: AgentBrowserSession | null = null;

function browserSession() {
  if (browser) return browser;
  const conversationId = requiredEnvironment("CHIEF_CONVERSATION_ID");
  browser = new AgentBrowserSession({
    sessionId: `${requiredEnvironment("CHIEF_AGENT_ID")}-${conversationId}`,
    downloadPath: join(
      requiredEnvironment("CHIEF_CELL_ROOT"),
      "browser",
      conversationId,
    ),
    encryptionKey: requiredEnvironment("CHIEF_AGENT_SECRET_KEY"),
    restore: true,
    colorScheme: "dark",
  });
  return browser;
}

function publicHttpsUrl(raw: string) {
  const url = new URL(raw);
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  const privateAddress =
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    /^(?:127|10|0)\./u.test(hostname) ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("169.254.") ||
    /^172\.(?:1[6-9]|2\d|3[01])\./u.test(hostname) ||
    hostname === "::1" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe80:");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    privateAddress
  ) {
    throw new Error("url must be a public HTTPS address without credentials.");
  }
  return url.toString();
}

async function callBrowserTool(name: string, input: JsonObject) {
  const session = browserSession();
  if (name === "browser_navigate") {
    await session.open(publicHttpsUrl(string(input, "url")), {
      width: 1280,
      height: 800,
    });
    return await session.snapshot();
  }
  if (name === "browser_snapshot") return await session.snapshot();
  if (name === "browser_click") {
    await session.click([string(input, "target")]);
    return await session.snapshot();
  }
  if (name === "browser_type") {
    await session.fill([string(input, "target")], string(input, "text"));
    if (input.submit === true) await session.press("Enter");
    return await session.snapshot();
  }
  if (name === "browser_scroll") {
    const direction = string(input, "direction");
    const rawAmount = parseJsonNumber(input.amount);
    const amount =
      rawAmount !== undefined && Number.isInteger(rawAmount)
        ? Math.min(10_000, Math.max(1, rawAmount))
        : 800;
    const x =
      direction === "left" ? -amount : direction === "right" ? amount : 0;
    const y = direction === "up" ? -amount : direction === "down" ? amount : 0;
    await session.evaluate(`window.scrollBy(${x}, ${y})`);
    return await session.snapshot();
  }
  if (name === "browser_back") {
    await session.command(["back"]);
    return await session.snapshot();
  }
  if (name === "browser_release") {
    const outcome = string(input, "outcome");
    if (outcome === "completed") await session.close();
    return { outcome, label: optionalString(input, "label") ?? null };
  }
  throw new Error("Unknown browser tool.");
}

async function callRelayTool<Input>(name: string, rawInput: Input) {
  const client = relayClient();
  const agentId = requiredEnvironment("CHIEF_AGENT_ID");
  const input = object(rawInput);
  if (name.startsWith("browser_")) return await callBrowserTool(name, input);
  if (name === "relay_channels_list") {
    return { channels: await client.listChannels() };
  }
  if (name === "relay_messages_list") {
    const after = parseJsonNumber(input.after);
    return await client.listMessages(string(input, "conversationId"), {
      after,
      limit: 200,
    });
  }
  if (name === "relay_thread_replies") {
    const after = parseJsonNumber(input.after);
    return await client.listThreadReplies(
      string(input, "conversationId"),
      string(input, "rootMessageId"),
      {
        after,
        limit: 200,
      },
    );
  }
  if (name === "relay_message_search") {
    return await client.searchMessages(
      string(input, "conversationId"),
      string(input, "query"),
      { limit: 50 },
    );
  }
  if (name === "relay_workspace_members") {
    return { members: await client.listWorkspaceMembers() };
  }
  if (name === "relay_channels_create") {
    const conversationId = string(input, "conversationId");
    const existing = (await client.listChannels()).find(
      (channel) => channel.id === conversationId,
    );
    if (existing) return { channel: existing, created: false };
    return {
      channel: await client.createChannel({
        conversationId,
        name: string(input, "name"),
        isPrivate: input.isPrivate === true,
      }),
      created: true,
    };
  }
  if (name === "relay_channels_members_add") {
    const kind = string(input, "kind");
    if (kind !== "user" && kind !== "agent") {
      throw new Error("kind must be user or agent.");
    }
    const principalId = optionalString(input, "principalId");
    const principalIds = Array.isArray(input.principalIds)
      ? input.principalIds.flatMap((value) => {
          const parsed = parseJsonString(value)?.trim();
          return parsed ? [parsed] : [];
        })
      : [];
    if (principalId) principalIds.push(principalId);
    const uniqueIds = [...new Set(principalIds)];
    if (uniqueIds.length === 0)
      throw new Error("At least one principal is required.");
    await client.addChannelMembers(
      string(input, "conversationId"),
      uniqueIds.map((principalId) => ({ kind, principalId })),
    );
    return { added: uniqueIds };
  }
  if (name === "relay_message_post") {
    const conversationId = string(input, "conversationId");
    const body = string(input, "body");
    const threadRootId = optionalString(input, "threadRootId");
    if (optionalString(input, "idempotencyKey")) {
      const existing = (
        await client.listMessages(conversationId, { limit: 200 })
      ).messages.find(
        (message) =>
          message.author.kind === "agent" &&
          message.author.id === agentId &&
          message.body === body &&
          message.threadRootId === threadRootId,
      );
      if (existing) return { message: existing, duplicate: true };
    }
    const command = appendMessageCommandSchema.parse({
      commandId: randomUUID(),
      protocolVersion: 1,
      occurredAt: new Date().toISOString(),
      payload: {
        messageId: randomUUID(),
        conversationId,
        threadRootId,
        body,
        mentions: inferredMentions(body),
        components: [],
      },
    });
    return await client.appendMessage(conversationId, command);
  }
  if (name === "relay_reaction_add" || name === "relay_reaction_remove") {
    return await client.reactToMessage(
      string(input, "conversationId"),
      string(input, "messageId"),
      string(input, "emoji"),
      name === "relay_reaction_add",
    );
  }
  if (name === "brand_profile_get") {
    return { profile: await client.loadBrandProfile() };
  }
  if (name === "brand_profile_save") {
    return await client.saveBrandProfile({
      markdown: string(input, "markdown"),
      sourceUrls: Array.isArray(input.sourceUrls)
        ? input.sourceUrls.flatMap((value) => {
            const parsed = parseJsonString(value);
            return parsed === undefined ? [] : [parsed];
          })
        : [],
      conversationId: string(input, "conversationId"),
    });
  }
  if (name === "prospects_list")
    return { prospects: await client.listProspects() };
  if (name === "prospects_save")
    return await client.saveProspect(input.prospect);
  if (name === "workspace_files_list") {
    return { files: await client.listWorkspaceFiles() };
  }
  if (name === "workspace_files_save") {
    const id = optionalString(input, "id");
    const expectedVersion = parseJsonNumber(input.expectedVersion);
    return await client.saveWorkspaceFile({
      id,
      path: string(input, "path"),
      title: string(input, "title"),
      mimeType: string(input, "mimeType"),
      content: string(input, "content"),
      conversationId: string(input, "conversationId"),
      expectedVersion,
    });
  }
  if (name === "relay_projects_list") {
    return { projects: await client.listProjects() };
  }
  const workspaceId = requiredEnvironment("CHIEF_WORKSPACE_ID");
  if (name.startsWith("plugins_")) {
    return await callPluginTool(name, input, { client, workspaceId, agentId });
  }
  throw new Error("Unknown relay tool.");
}

function buildRelayCellMcpServer() {
  const config = parseConfig();
  const permitted = new Set<string>(config.toolPermissions);
  const visible = toolDefinitions.filter((tool) =>
    permitted.has(toolRequirements[tool.name] ?? ""),
  );
  const server = new Server(
    { name: "chief-relay", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () =>
    Promise.resolve().then(() => {
      cellToolDiagnostic("catalog", {
        permissions: [...permitted].sort(),
        toolNames: visible.map((tool) => tool.name),
      });
      return { tools: visible };
    }),
  );
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = visible.find(
      (candidate) => candidate.name === request.params.name,
    );
    if (!tool) {
      return {
        isError: true,
        content: [
          { type: "text", text: "This cell is not authorized for that tool." },
        ],
      };
    }
    try {
      cellToolDiagnostic("started", { toolName: tool.name });
      const result = await callRelayTool(tool.name, request.params.arguments);
      cellToolDiagnostic("completed", { toolName: tool.name });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    } catch (error) {
      cellToolDiagnostic("failed", {
        toolName: tool.name,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  });
  return server;
}

export async function runRelayCellMcpServer() {
  const server = buildRelayCellMcpServer();
  await server.connect(new StdioServerTransport());
}

export function startRelayCellMcpHttpServer() {
  return startRelayCellMcpHttpTransport(buildRelayCellMcpServer);
}
