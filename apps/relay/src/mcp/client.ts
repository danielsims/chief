import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";

import type {
  JsonValue,
  McpToolCallResult,
  McpToolSummary,
} from "@chief/relay-contracts";
import { jsonObjectSchema, jsonValueSchema } from "@chief/relay-contracts";

import type { McpFetchLimits } from "./fetch-guard";
import { guardedMcpFetch } from "./fetch-guard";

const maximumTools = 256;
const maximumPages = 10;
const maximumResultCharacters = 64_000;

export interface McpServerAccess {
  url: string;
  headers?: { name: string; value: string }[];
  authProvider?: OAuthClientProvider;
  limits: McpFetchLimits;
}

async function withClient<T>(
  access: McpServerAccess,
  use: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client(
    { name: "chief", version: "1.0.0" },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );
  const transport = new StreamableHTTPClientTransport(new URL(access.url), {
    fetch: guardedMcpFetch(access.limits),
    authProvider: access.authProvider,
    requestInit: access.headers?.length
      ? {
          headers: Object.fromEntries(
            access.headers.map(({ name, value }) => [name, value]),
          ),
        }
      : undefined,
  });
  await client.connect(transport);
  try {
    return await use(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export function listMcpTools(access: McpServerAccess) {
  return withClient(access, async (client) => {
    const tools: McpToolSummary[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      for (const tool of page.tools) {
        if (tools.length >= maximumTools) break;
        const schema = jsonObjectSchema.safeParse(tool.inputSchema);
        tools.push({
          name: tool.name.slice(0, 128),
          ...(tool.title || tool.annotations?.title
            ? {
                title: (tool.title ?? tool.annotations?.title ?? "").slice(
                  0,
                  200,
                ),
              }
            : undefined),
          description: (tool.description ?? "").slice(0, 4_000),
          inputSchema: schema.success ? schema.data : {},
          // Only an explicit read-only hint makes a tool a read. A server that
          // says nothing is treated as able to change things.
          readOnly: tool.annotations?.readOnlyHint === true,
          destructive:
            tool.annotations?.readOnlyHint !== true &&
            tool.annotations?.destructiveHint !== false,
        });
      }
      pages += 1;
      cursor =
        tools.length < maximumTools && pages < maximumPages
          ? page.nextCursor
          : undefined;
    } while (cursor);
    return tools;
  });
}

export function callMcpTool(
  access: McpServerAccess,
  name: string,
  args: Record<string, JsonValue>,
): Promise<McpToolCallResult> {
  return withClient(access, async (client) => {
    const result = await client.callTool({ name, arguments: args });
    const content = jsonValueSchema.safeParse(
      result.structuredContent ?? result.content ?? null,
    );
    const value = content.success ? content.data : null;
    const serialised = JSON.stringify(value);
    const truncated = serialised.length > maximumResultCharacters;
    return {
      isError: result.isError === true,
      content: truncated ? serialised.slice(0, maximumResultCharacters) : value,
      truncated,
    };
  });
}
