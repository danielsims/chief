import type { McpConnection } from "@chief/relay-contracts";

import type { McpCredentialStore } from "./credentials";
import type { McpFetchLimits } from "./fetch-guard";
import { HttpError } from "../http";
import { listMcpTools } from "./client";
import { oneAtATime } from "./oauth-policy";

/** Validate the candidate without disturbing the key serving existing calls. */
export function replaceMcpHeaders(input: {
  connection: McpConnection;
  headers: { name: string; value: string }[];
  limits: McpFetchLimits;
  credentials: McpCredentialStore;
  read: () => McpConnection;
  save: (connection: McpConnection) => McpConnection;
  lockKey: string;
}) {
  const { connection, headers, limits, credentials, read, save, lockKey } =
    input;
  requirePluginHeaders(headers);
  if (connection.auth.kind !== "headers")
    throw new HttpError(
      409,
      "plugin_not_headers",
      "This plugin does not sign in with a key.",
    );
  return oneAtATime(lockKey, async () => {
    let tools;
    try {
      tools = await listMcpTools({ url: connection.url, headers, limits });
    } catch {
      throw new HttpError(
        422,
        "plugin_key_rejected",
        `${connection.name} rejected this key.`,
      );
    }
    if (read().createdAt !== connection.createdAt)
      throw new HttpError(
        404,
        "plugin_not_found",
        "This plugin is not connected.",
      );
    await credentials.write(connection.id, connection.url, {
      kind: "headers",
      headers,
    });
    return save({
      ...connection,
      auth: { kind: "headers", headerNames: headers.map(({ name }) => name) },
      status: "connected",
      error: undefined,
      tools,
      toolsFetchedAt: Date.now(),
    });
  });
}

/** Headers owned by the transport cannot be supplied as credentials. */
export function requirePluginHeaders(
  headers: { name: string; value: string }[],
) {
  for (const { name } of headers)
    if (
      /^(host|cookie|connection|keep-alive|content-|transfer-encoding|upgrade|te|trailer|proxy-|forwarded|x-forwarded-|mcp-session-id|mcp-protocol-version|last-event-id)/iu.test(
        name,
      )
    )
      throw new HttpError(
        400,
        "plugin_header_reserved",
        `${name} cannot be set for a plugin.`,
      );
}
