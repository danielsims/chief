import { z } from "zod";

import {
  mcpConnectionClientSchema,
  mcpConnectionCreateSchema,
  mcpToolCallSchema,
} from "@chief/relay-contracts";

import { HttpError, json, parseJson } from "../http";
import { readTrustedContext } from "../internal-context";
import { requireWorkspaceAdministrator } from "../workspace-administration";
import { WorkspaceChannelStore } from "../workspace-channel-store";
import { McpConnectionService } from "./connection-service";

export const mcpOAuthCallbackInputSchema = z.object({
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  binding: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/u)
    .nullable(),
  code: z.string().max(4_096).nullable(),
  error: z.string().max(256).nullable(),
  issuer: z.string().max(2_048).nullable(),
});

/** Internal operations on the workspace object. */
export async function routeMcpConnections(
  storage: DurableObjectStorage,
  env: Env,
  request: Request,
  operation: string,
) {
  const context = readTrustedContext(request);
  const service = new McpConnectionService(storage, env, context.workspaceId);
  const id = request.headers.get("x-chief-plugin-id") ?? "";
  const browserLeg =
    context.principal.kind === "service" &&
    context.principal.service === "mcp-oauth";
  if (operation.startsWith("mcp-oauth-")) {
    if (!browserLeg)
      throw new HttpError(403, "plugin_call_denied", "Not allowed.");
    const body = z
      .record(z.string(), z.unknown())
      .parse(await parseJson(request));
    if (operation === "mcp-oauth-describe")
      return json(
        await service.describeStart(z.string().parse(body.startToken)),
      );
    if (operation === "mcp-oauth-confirm")
      return json(
        await service.confirmStart(z.string().parse(body.startToken)),
      );
    if (operation === "mcp-oauth-callback")
      return json(
        await service.completeCallback(mcpOAuthCallbackInputSchema.parse(body)),
      );
  }
  const automation =
    context.principal.kind === "service" &&
    context.principal.service === "automation";
  if (automation && operation !== "mcp-call")
    throw new HttpError(403, "plugin_call_denied", "Not allowed.");
  const channels = new WorkspaceChannelStore(storage, env);
  channels.requireWorkspace(context.workspaceId);
  if (!automation) channels.requirePrincipalMember(context.principal);
  if (operation === "mcp-call")
    return json(
      await service.callTool(
        context.principal,
        mcpToolCallSchema.parse(await parseJson(request)),
      ),
    );
  if (operation === "mcp-list") {
    // Some servers carry a secret in their address, so only admins see it.
    let admin = false;
    try {
      requireWorkspaceAdministrator(channels, context.principal);
      admin = true;
    } catch {
      admin = false;
    }
    return json({
      connections: service
        .list()
        .map((connection) =>
          admin
            ? connection
            : { ...connection, url: new URL(connection.url).origin },
        ),
    });
  }
  if (operation === "mcp-create")
    return json(
      await service.create(
        context.principal,
        mcpConnectionCreateSchema.parse(await parseJson(request)),
      ),
      { status: 201 },
    );
  if (operation === "mcp-delete")
    return json(await service.remove(context.principal, id));
  if (operation === "mcp-authorize")
    return json(await service.authorize(context.principal, id));
  if (operation === "mcp-client")
    return json(
      await service.configureClient(
        context.principal,
        id,
        mcpConnectionClientSchema.parse(await parseJson(request)),
      ),
    );
  if (operation === "mcp-refresh") {
    requireWorkspaceAdministrator(channels, context.principal);
    return json(await service.refreshTools(service.read(id)));
  }
  return undefined;
}
