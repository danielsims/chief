import { z } from "zod";

import type { JsonObject } from "@chief/relay-contracts";
import { jsonObjectSchema } from "@chief/relay-contracts";

import { CHANNEL_MESSAGE_EVENT } from "./channel-guest-delivery";
import {
  guestInstructions,
  guestMcpTools,
  guestToolSpec,
} from "./channel-guest-manual";

/** Forwards one guest operation to the workspace and returns its response. */
export type GuestOperationCall = (
  operation: string,
  input: { search?: Record<string, string>; body?: JsonObject },
) => Promise<Response>;

const modernVersion = "2026-07-28";
const legacyVersions = ["2025-11-25", "2025-06-18", "2025-03-26"];
const supportedVersions = [modernVersion, ...legacyVersions];
const serverInfo = { name: "chief-channel", version: "1.0.0" };

const instructions = guestInstructions("one channel");

const rpcSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z
    .object({
      _meta: z
        .object({
          "io.modelcontextprotocol/protocolVersion": z.string().optional(),
        })
        .loose()
        .optional(),
      name: z.string().optional(),
      arguments: z.record(z.string(), z.json()).optional(),
      protocolVersion: z.string().optional(),
    })
    .loose()
    .optional(),
});

type Rpc = z.infer<typeof rpcSchema>;

const events: JsonObject[] = [
  {
    name: CHANNEL_MESSAGE_EVENT,
    description:
      "A new message in the channel that concerns you: an @mention, a reply in a thread you posted in, or any message when wake is `all`.",
    delivery: ["webhook"],
    inputSchema: {
      type: "object",
      properties: { wake: { type: "string", enum: ["mentions", "all"] } },
      required: [],
      additionalProperties: false,
    },
    payloadSchema: {
      type: "object",
      properties: {
        channel: { type: "object" },
        reason: { type: "string", enum: ["mention", "thread", "all"] },
        message: { type: "object" },
        reply: { type: "object" },
      },
      required: ["channel", "reason", "message", "reply"],
      additionalProperties: false,
    },
  },
];

export async function handleGuestMcp(
  request: Request,
  call: GuestOperationCall,
) {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  }
  const parsed = rpcSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return rpcResponse(null, undefined, {
      code: -32600,
      message: "Invalid request.",
    });
  }
  const rpc = parsed.data;
  if (rpc.id === undefined) return new Response(null, { status: 202 });
  const requested =
    rpc.params?._meta?.["io.modelcontextprotocol/protocolVersion"] ??
    request.headers.get("mcp-protocol-version") ??
    undefined;
  const modern = rpc.method !== "initialize" && requested === modernVersion;
  if (requested && !supportedVersions.includes(requested)) {
    return rpcResponse(rpc.id, undefined, {
      code: -32022,
      message: "Unsupported protocol version",
      data: { supported: supportedVersions, requested },
    });
  }
  try {
    const result = await dispatch(rpc, call);
    if ("error" in result) return rpcResponse(rpc.id, undefined, result.error);
    return rpcResponse(
      rpc.id,
      modern
        ? {
            resultType: "complete",
            ...result.value,
            _meta: { "io.modelcontextprotocol/serverInfo": serverInfo },
          }
        : result.value,
    );
  } catch (error) {
    return rpcResponse(rpc.id, undefined, {
      code: -32602,
      message:
        error instanceof z.ZodError ? "Invalid params." : "Request failed.",
    });
  }
}

async function dispatch(
  rpc: Rpc,
  call: GuestOperationCall,
): Promise<{ value: JsonObject } | { error: RpcError }> {
  switch (rpc.method) {
    case "initialize": {
      const asked = rpc.params?.protocolVersion;
      return {
        value: {
          protocolVersion:
            asked && legacyVersions.includes(asked) ? asked : "2025-11-25",
          capabilities: { tools: {} },
          serverInfo,
          instructions,
        },
      };
    }
    case "server/discover":
      return {
        value: {
          supportedVersions,
          capabilities: { tools: {}, events: {} },
          instructions,
          ttlMs: 3_600_000,
          cacheScope: "public",
        },
      };
    case "ping":
      return { value: {} };
    case "tools/list":
      return {
        value: {
          tools: guestMcpTools(),
          ttlMs: 3_600_000,
          cacheScope: "public",
        },
      };
    case "events/list":
      return { value: { events } };
    case "events/subscribe":
    case "events/unsubscribe": {
      const response = await call(
        rpc.method === "events/subscribe"
          ? "guest-events-subscribe"
          : "guest-events-unsubscribe",
        { body: eventParams(rpc) },
      );
      const body = await readJson(response);
      if (!response.ok) {
        const failure = errorMessage(body);
        return {
          error: {
            code:
              failure.code === "callback_verification_failed" ? -32015 : -32602,
            message: failure.message,
            ...(failure.code === "callback_verification_failed"
              ? { data: { reason: "challenge_failed" } }
              : undefined),
          },
        };
      }
      return { value: body };
    }
    case "tools/call":
      return { value: await callTool(rpc, call) };
  }
  return { error: { code: -32601, message: `Unknown method ${rpc.method}.` } };
}

async function callTool(rpc: Rpc, call: GuestOperationCall) {
  const tool = guestToolSpec(rpc.params?.name ?? "");
  if (!tool) return toolResult({ error: "Unknown tool." }, true);
  const parsed = tool.input.safeParse(rpc.params?.arguments ?? {});
  if (!parsed.success) {
    return toolResult({ error: z.prettifyError(parsed.error) }, true);
  }
  const args = jsonObjectSchema.parse(parsed.data);
  const response =
    tool.method === "GET"
      ? await call(tool.operation, { search: searchParams(args) })
      : await call(
          tool.operation,
          tool.method === "DELETE" ? {} : { body: args },
        );
  const body = await readJson(response);
  if (!response.ok) return toolResult({ error: errorMessage(body) }, true);
  return toolResult(body, false);
}

const queryValueSchema = z.union([z.string(), z.number()]);

/** GET tools take their arguments as query parameters. */
function searchParams(args: JsonObject) {
  return Object.fromEntries(
    Object.entries(args).flatMap(([name, value]) => {
      const parsed = queryValueSchema.safeParse(value);
      return parsed.success ? [[name, String(parsed.data)]] : [];
    }),
  );
}

/** Event requests carry their arguments beside protocol `_meta`, which the
 * workspace does not need. */
function eventParams(rpc: Rpc): JsonObject {
  const { _meta: _ignored, ...params } = rpc.params ?? {};
  return jsonObjectSchema.parse(params);
}

interface RpcError {
  code: number;
  message: string;
  data?: JsonObject;
}

/** The workspace always answers with a JSON object; anything else is a
 * transport failure and reads as an empty object. */
async function readJson(response: Response): Promise<JsonObject> {
  const value = await response.json().catch(() => null);
  return jsonObjectSchema.safeParse(value).data ?? {};
}

function toolResult(body: JsonObject, isError: boolean): JsonObject {
  return {
    content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
    ...(isError ? undefined : { structuredContent: body }),
    isError,
  };
}

const relayErrorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

function errorMessage(body: JsonObject) {
  const parsed = relayErrorBodySchema.safeParse(body);
  return parsed.success
    ? parsed.data.error
    : { code: "request_failed", message: "The request failed." };
}

function rpcResponse(
  id: string | number | null,
  result: JsonObject | undefined,
  error?: RpcError,
) {
  return new Response(
    JSON.stringify(
      error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result },
    ),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    },
  );
}
