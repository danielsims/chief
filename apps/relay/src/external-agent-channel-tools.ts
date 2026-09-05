import type { JsonObject } from "@chief/relay-contracts";
import {
  appendMessageCommandSchema,
  appendMessageResultSchema,
  channelListResultSchema,
  externalAgentToolCallSchema,
  externalAgentToolResultSchema,
  messagePageSchema,
  parseJsonNumber,
  parseJsonObject,
  parseJsonValue,
  reactToMessagePayloadSchema,
  toJsonObject,
} from "@chief/relay-contracts";

import type { ExternalAgentInboundHost } from "./external-agent-continuation";
import { dispatchAppendedMessage } from "./conversation-agent-dispatch";
import { deterministicUuid } from "./external-agent-channel-security";
import { resolveExternalContinuation } from "./external-agent-continuation";
import { externalConversationFetch } from "./external-agent-conversation";
import {
  mentionIds,
  optionalString,
  requiredString,
} from "./hosted-agent-tools/input";
import { HttpError, json, parseJson } from "./http";
import { releaseInternalResponse } from "./internal-response";
import { WorkspaceChannelMembership } from "./workspace-channel-membership";
import { WorkspaceChannelService } from "./workspace-channel-service";
import { routeWorkspaceData } from "./workspace-data-store";

type ResolvedContinuation = Awaited<
  ReturnType<typeof resolveExternalContinuation>
>;

export async function receiveExternalAgentTool(
  host: ExternalAgentInboundHost,
  request: Request,
  rawAgentId: string,
) {
  const input = externalAgentToolCallSchema.parse(await parseJson(request));
  const resolved = await resolveExternalContinuation(
    host,
    request,
    rawAgentId,
    input,
  );
  const result = await executeExternalAgentTool(host, resolved, input);
  return json(
    externalAgentToolResultSchema.parse({
      operationId: input.operationId,
      result,
    }),
  );
}

async function executeExternalAgentTool(
  host: ExternalAgentInboundHost,
  resolved: ResolvedContinuation,
  call: ReturnType<typeof externalAgentToolCallSchema.parse>,
): Promise<JsonObject> {
  const channelId =
    optionalString(call.input, "channelId") ??
    resolved.continuation.conversation_id;
  switch (call.operationId) {
    case "channels.list":
      return await listChannels(host, resolved, call.input);
    case "channels.get":
      return await readJsonObject(
        new WorkspaceChannelService(host.channels).channelsGet(
          channelRequest(requiredChannelId(call.input, channelId)),
          toolContext(resolved, requiredChannelId(call.input, channelId)),
        ),
      );
    case "channels.members.list":
      return await readJsonObject(
        await new WorkspaceChannelMembership(host.channels).channelsMembersList(
          channelRequest(requiredChannelId(call.input, channelId)),
          toolContext(resolved, requiredChannelId(call.input, channelId)),
        ),
      );
    case "channels.messages.list":
      return await conversationJson(
        host,
        resolved,
        requiredChannelId(call.input, channelId),
        "messages.read",
        messageListPath(call.input),
      );
    case "channels.messages.get":
      return await getMessage(
        host,
        resolved,
        requiredChannelId(call.input, channelId),
        requiredString(call.input, "messageId"),
      );
    case "channels.messages.post":
      return await postMessage(host, resolved, call);
    case "channels.messages.replies":
      return await conversationJson(
        host,
        resolved,
        requiredChannelId(call.input, channelId),
        "messages.read",
        `/messages/${encodeURIComponent(requiredString(call.input, "messageId"))}/replies${messageListQuery(call.input)}`,
      );
    case "channels.reactions.list":
      return await conversationJson(
        host,
        resolved,
        requiredChannelId(call.input, channelId),
        "messages.read",
        `/messages/${encodeURIComponent(requiredString(call.input, "messageId"))}/reactions`,
      );
    case "channels.reactions.add":
      return await reactToMessage(host, resolved, call, true);
    case "channels.reactions.remove":
      return await reactToMessage(host, resolved, call, false);
    case "projects.list":
      host.channels.requirePrincipalMember(resolved.principal);
      host.channels.requireAgentCapability(resolved.principal, "projects.read");
      const projects = await routeWorkspaceData(
        host.storage,
        new Request("https://workspace.internal", { method: "POST" }),
        "data-projects-list",
        resolved.principal,
        resolved.context.workspaceId,
        host.channels,
      );
      if (!projects) {
        throw new HttpError(
          404,
          "external_tool_unknown",
          "Workspace projects are unavailable.",
        );
      }
      return await readJsonObject(projects);
    case "projects.recommend":
      return await recommendProject(host, resolved, call);
    default:
      throw new HttpError(
        400,
        "external_tool_unknown",
        `Unknown Chief tool operation: ${call.operationId}.`,
      );
  }
}

function toolContext(resolved: ResolvedContinuation, conversationId: string) {
  return {
    principal: resolved.principal,
    requestId: resolved.context.requestId,
    workspaceId: resolved.context.workspaceId,
    conversationId,
  };
}

function channelRequest(conversationId: string) {
  return new Request(
    `https://workspace.internal/?conversationId=${encodeURIComponent(conversationId)}`,
  );
}

function requiredChannelId(input: JsonObject, fallback: string) {
  return optionalString(input, "channelId") ?? fallback;
}

async function listChannels(
  host: ExternalAgentInboundHost,
  resolved: ResolvedContinuation,
  input: JsonObject,
) {
  host.channels.requirePrincipalMember(resolved.principal);
  host.channels.requireAgentCapability(resolved.principal, "channels.read");
  const listed = channelListResultSchema.parse(
    await readJsonObject(
      new WorkspaceChannelService(host.channels).channelsList({
        principal: resolved.principal,
        requestId: resolved.context.requestId,
        workspaceId: resolved.context.workspaceId,
        conversationId: null,
      }),
    ),
  );
  const includeArchived = optionalString(input, "includeArchived") === "true";
  const query = optionalString(input, "query")?.toLowerCase();
  return toJsonObject({
    channels: listed.channels.filter((channel) => {
      if (!includeArchived && channel.archived) return false;
      return !query || channel.name.toLowerCase().includes(query);
    }),
  });
}

async function postMessage(
  host: ExternalAgentInboundHost,
  resolved: ResolvedContinuation,
  call: ReturnType<typeof externalAgentToolCallSchema.parse>,
) {
  const conversationId = requiredChannelId(
    call.input,
    resolved.continuation.conversation_id,
  );
  const threadRootId =
    optionalString(call.input, "threadRootId") ??
    (conversationId === resolved.continuation.conversation_id
      ? (resolved.continuation.thread_root_id ?? undefined)
      : undefined);
  const idempotencyKey =
    optionalString(call.input, "idempotencyKey") ??
    `${call.deliveryId}:${conversationId}`;
  const messageId = await deterministicUuid(
    `${resolved.context.workspaceId}:${resolved.agentId}:tool:channels.messages.post:${idempotencyKey}`,
  );
  host.channels.requirePrincipalMember(resolved.principal);
  host.channels.requireAgentCapability(resolved.principal, "messages.send");
  host.channels.requireChannelVisible(conversationId, resolved.principal);
  const command = appendMessageCommandSchema.parse({
    commandId: messageId,
    protocolVersion: 1,
    occurredAt: new Date().toISOString(),
    payload: {
      messageId,
      conversationId,
      ...(threadRootId ? { threadRootId } : undefined),
      body: requiredString(call.input, "content"),
      mentions: mentionIds(call.input, "mentions"),
      components: [],
    },
  });
  const appendRequest = new Request("https://relay.internal/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(command),
  });
  const response = await externalConversationFetch(
    host.env,
    resolved.context.workspaceId,
    conversationId,
    appendRequest,
    resolved.principal,
    resolved.context.requestId,
  );
  if (!response.ok) return await readJsonObject(response);
  const result = appendMessageResultSchema.parse(await response.clone().json());
  const dispatched = await dispatchAppendedMessage(host.env, {
    request: appendRequest,
    response,
    principal: resolved.principal,
    requestId: resolved.context.requestId,
    workspaceId: resolved.context.workspaceId,
    conversationId,
  });
  if (!dispatched.ok) return await readJsonObject(dispatched);
  await releaseInternalResponse(dispatched);
  return toJsonObject({
    ok: true,
    duplicate: result.duplicate,
    message: result.message,
  });
}

async function recommendProject(
  host: ExternalAgentInboundHost,
  resolved: ResolvedContinuation,
  call: ReturnType<typeof externalAgentToolCallSchema.parse>,
) {
  const conversationId = requiredChannelId(
    call.input,
    resolved.continuation.conversation_id,
  );
  const threadRootId =
    optionalString(call.input, "threadRootId") ??
    (conversationId === resolved.continuation.conversation_id
      ? (resolved.continuation.thread_root_id ?? undefined)
      : undefined);
  const idempotencyKey =
    optionalString(call.input, "idempotencyKey") ??
    `${call.deliveryId}:${conversationId}:project`;
  const messageId = await deterministicUuid(
    `${resolved.context.workspaceId}:${resolved.agentId}:tool:projects.recommend:${idempotencyKey}`,
  );
  const remoteUrl = optionalString(call.input, "remoteUrl");
  host.channels.requirePrincipalMember(resolved.principal);
  host.channels.requireAgentCapability(resolved.principal, "messages.send");
  host.channels.requireChannelVisible(conversationId, resolved.principal);
  const command = appendMessageCommandSchema.parse({
    commandId: messageId,
    protocolVersion: 1,
    occurredAt: new Date().toISOString(),
    payload: {
      messageId,
      conversationId,
      ...(threadRootId ? { threadRootId } : undefined),
      body: requiredString(call.input, "content"),
      mentions: [],
      components: [
        {
          id: messageId,
          kind: "project.recommendation",
          version: 1,
          payload: {
            workspaceId: resolved.context.workspaceId,
            conversationId,
            ...(threadRootId ? { threadRootId } : undefined),
            agentId: resolved.agentId,
            title: "Connect a repository",
            description:
              "Add the Git repository this workspace should work in.",
            ...(remoteUrl ? { remoteUrl } : undefined),
          },
        },
      ],
    },
  });
  const appendRequest = new Request("https://relay.internal/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(command),
  });
  const response = await externalConversationFetch(
    host.env,
    resolved.context.workspaceId,
    conversationId,
    appendRequest,
    resolved.principal,
    resolved.context.requestId,
  );
  if (!response.ok) return await readJsonObject(response);
  const result = appendMessageResultSchema.parse(await response.clone().json());
  const dispatched = await dispatchAppendedMessage(host.env, {
    request: appendRequest,
    response,
    principal: resolved.principal,
    requestId: resolved.context.requestId,
    workspaceId: resolved.context.workspaceId,
    conversationId,
  });
  if (!dispatched.ok) return await readJsonObject(dispatched);
  await releaseInternalResponse(dispatched);
  return toJsonObject({
    ok: true,
    duplicate: result.duplicate,
    conversationId,
  });
}

async function reactToMessage(
  host: ExternalAgentInboundHost,
  resolved: ResolvedContinuation,
  call: ReturnType<typeof externalAgentToolCallSchema.parse>,
  add: boolean,
) {
  const conversationId = requiredChannelId(
    call.input,
    resolved.continuation.conversation_id,
  );
  const messageId = requiredString(call.input, "messageId");
  const emoji = requiredString(call.input, "emoji");
  host.channels.requirePrincipalMember(resolved.principal);
  host.channels.requireAgentCapability(resolved.principal, "messages.send");
  host.channels.requireChannelVisible(conversationId, resolved.principal);
  return await conversationJson(
    host,
    resolved,
    conversationId,
    "messages.send",
    `/messages/${encodeURIComponent(messageId)}/reactions`,
    {
      method: add ? "POST" : "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        reactToMessagePayloadSchema.parse({ messageId, emoji }),
      ),
    },
  );
}

async function getMessage(
  host: ExternalAgentInboundHost,
  resolved: ResolvedContinuation,
  conversationId: string,
  messageId: string,
) {
  const page = messagePageSchema.parse(
    await conversationJson(
      host,
      resolved,
      conversationId,
      "messages.read",
      "/messages?limit=200",
    ),
  );
  const match = page.messages.find((message) => message.id === messageId);
  if (match) return toJsonObject({ message: match });
  throw new HttpError(404, "message_not_found", "The message was not found.");
}

async function conversationJson(
  host: ExternalAgentInboundHost,
  resolved: ResolvedContinuation,
  conversationId: string,
  permission: "messages.read" | "messages.send",
  path: string,
  init?: RequestInit,
) {
  host.channels.requirePrincipalMember(resolved.principal);
  host.channels.requireAgentCapability(resolved.principal, permission);
  host.channels.requireChannelVisible(conversationId, resolved.principal);
  return await readJsonObject(
    await externalConversationFetch(
      host.env,
      resolved.context.workspaceId,
      conversationId,
      new Request(`https://relay.internal${path}`, init),
      resolved.principal,
      resolved.context.requestId,
    ),
  );
}

function messageListPath(input: JsonObject) {
  return `/messages${messageListQuery(input)}`;
}

function messageListQuery(input: JsonObject) {
  const params = new URLSearchParams();
  const cursor = optionalString(input, "cursor");
  const after = cursor ? Number(cursor) : undefined;
  if (after !== undefined && Number.isFinite(after)) {
    params.set("after", String(after));
  }
  const limit = parseJsonNumber(input.limit);
  if (limit !== undefined) params.set("limit", String(limit));
  const query = params.toString();
  return query ? `?${query}` : "";
}

async function readJsonObject(response: Response) {
  const text = await response.text();
  if (!response.ok) {
    throw new HttpError(
      response.status,
      "external_tool_failed",
      text || "Chief tool failed.",
    );
  }
  return parseToolJson(text);
}

function parseToolJson(text: string) {
  if (!text) return { ok: true };
  const parsed = parseJsonObject(parseJsonValue(JSON.parse(text)));
  if (!parsed) throw new Error("Chief tool returned invalid JSON.");
  return parsed;
}
