import { env } from "cloudflare:workers";
import { expect } from "vitest";

import type { JsonObject, WorkspaceId } from "@chief/relay-contracts";
import {
  agentIdSchema,
  appendMessageCommandSchema,
  createWorkspaceCommandSchema,
  provisionWorkspaceCommandSchema,
  userIdSchema,
  workspaceIdSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import {
  withTrustedContext,
  withTrustedIdentity,
} from "../src/internal-context";
import { createManagedWorkspace } from "../src/workspace-authority";
import { hexKey } from "./helpers";

export const ownerId = userIdSchema.parse("channel-owner");
export const agentId = agentIdSchema.parse("coordinator");
export const outsiderId = userIdSchema.parse("channel-outsider");

export interface ChannelTestContext {
  env: Parameters<typeof createManagedWorkspace>[0];
  workspaceId: WorkspaceId;
  identity: { kind: "user"; userId: typeof ownerId; pubkey: string };
  principal: {
    kind: "user";
    userId: typeof ownerId;
    pubkey: string;
    workspaceId: WorkspaceId;
    role: "owner";
  };
}

export async function setupChannelTest(options?: {
  agentRuntime?: "relay-cell" | "vercel-eve";
}): Promise<ChannelTestContext> {
  const agentRuntime = options?.agentRuntime ?? "relay-cell";
  const relay: Parameters<typeof createManagedWorkspace>[0] = {
    ...env,
    BETTER_AUTH_SECRET: "test-auth-secret",
    BOOTSTRAP_TOKEN_SHA256: "test-bootstrap-token",
    CLOUDFLARE_ACCOUNT_ID: "test-account",
    CLOUDFLARE_EMAIL_API_TOKEN: "test-email-token",
    EMAIL_FROM_ADDRESS: "test@example.test",
    EMAIL_FROM_NAME: "Chief Test",
    RELAY_SECRET_KEY: "test-relay-secret-master-key-0123456789abcdef",
    RELAY_ID: "relay_test",
  };
  const identity = {
    kind: "user" as const,
    userId: ownerId,
    pubkey: hexKey(String(ownerId)),
  };
  const command = createWorkspaceCommandSchema.parse({
    commandId: crypto.randomUUID(),
    name: "Channel test",
    website: "https://heychief.sh",
    runtime: agentRuntime === "vercel-eve" ? "cloud" : "phone",
    agentRuntime,
    inferenceProvider:
      agentRuntime === "vercel-eve" ? "vercelAiGateway" : "openCodeGo",
    inferenceModel: "deepseek-v4-flash",
    selectedApps: [],
  });
  const created = await createManagedWorkspace(
    relay,
    identity,
    provisionWorkspaceCommandSchema.parse({
      workspace: command,
      secrets:
        agentRuntime === "vercel-eve" ? {} : { opencode: "test-opencode-key" },
    }),
  );
  const snapshot = workspaceSnapshotSchema.parse(await created.json());
  const workspaceId = workspaceIdSchema.parse(snapshot.id);
  return {
    env: relay,
    workspaceId,
    identity,
    principal: {
      kind: "user",
      userId: ownerId,
      pubkey: identity.pubkey,
      workspaceId,
      role: "owner",
    },
  };
}

export function channelRpc(
  ctx: ChannelTestContext,
  principal: Parameters<typeof withTrustedContext>[1]["principal"],
  operation: string,
  body?: JsonObject,
  query?: string,
  requiredPermission:
    "messages.read" | "messages.send" | "messages.manage" = "messages.read",
) {
  const headers = new Headers({ "x-chief-internal-operation": operation });
  if (operation === "authorize-conversation") {
    headers.set("x-chief-required-permission", requiredPermission);
  }
  let url = "https://workspace.internal/channels";
  if (query) url += `?${query}`;
  const init: RequestInit = { method: "POST", headers };
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  const request = withTrustedContext(new Request(url, init), {
    principal,
    requestId: crypto.randomUUID(),
    workspaceId: ctx.workspaceId,
  });
  return workspaceStub(ctx).fetch(request);
}

export function dispatchTestMessage(
  ctx: ChannelTestContext,
  principal: Parameters<typeof withTrustedContext>[1]["principal"],
  message: JsonObject & { conversationId: string },
) {
  const workspaces = ctx.env.WORKSPACES;
  return workspaces.get(workspaces.idFromName(ctx.workspaceId)).fetch(
    withTrustedContext(
      new Request("https://workspace.internal/agent-message-dispatch", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chief-internal-operation": "agent-message-dispatch",
        },
        body: JSON.stringify({ message }),
      }),
      {
        principal,
        requestId: crypto.randomUUID(),
        workspaceId: ctx.workspaceId,
        conversationId: message.conversationId,
      },
    ),
  );
}

export function registerTestAgent(
  ctx: ChannelTestContext,
  agentIdValue: string,
  pubkey: string,
) {
  const headers = new Headers({
    "x-chief-internal-operation": "register-agent-key",
    "content-type": "application/json",
  });
  const request = withTrustedIdentity(
    {
      identity: ctx.identity,
      requestId: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
    },
    {
      method: "POST",
      headers,
      body: JSON.stringify({ agentId: agentIdValue, pubkey }),
    },
  );
  return workspaceStub(ctx).fetch(request);
}

export function testAgentPrincipal(
  ctx: ChannelTestContext,
  agentIdValue: typeof agentId,
  pubkey: string,
) {
  return {
    kind: "agent" as const,
    agentId: agentIdValue,
    pubkey,
    workspaceId: ctx.workspaceId,
    role: "member" as const,
  };
}

export async function activeTestSnapshot(ctx: ChannelTestContext) {
  const { activeManagedWorkspace } = await import("../src/workspace-authority");
  const response = await activeManagedWorkspace(ctx.env, ctx.identity);
  return workspaceSnapshotSchema.parse(await response.json());
}

export async function testConversationMessages(
  ctx: ChannelTestContext,
  principal: Parameters<typeof withTrustedContext>[1]["principal"],
  conversationId: string,
) {
  const conversations = ctx.env.CONVERSATIONS;
  const stub = conversations.get(
    conversations.idFromName(`${ctx.workspaceId}:${conversationId}`),
  );
  const request = withTrustedContext(
    new Request("https://conversation.internal/messages?limit=200"),
    {
      principal,
      requestId: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
      conversationId,
    },
  );
  const response = await stub.fetch(request);
  expect(response.status).toBe(200);
  const page = (await response.json()) as {
    messages: Array<{
      id: string;
      author: { kind: string; id: string };
      body: string;
      components: Array<{ kind: string; payload: JsonObject }>;
      threadRootId?: string;
      reactions: Array<{ emoji: string; pubkeys: string[] }>;
    }>;
  };
  return page.messages;
}

export async function appendConversationMessage(
  ctx: ChannelTestContext,
  conversationId: string,
  body: string,
  messageId = crypto.randomUUID(),
) {
  const conversation = ctx.env.CONVERSATIONS.get(
    ctx.env.CONVERSATIONS.idFromName(`${ctx.workspaceId}:${conversationId}`),
  );
  const response = await conversation.fetch(
    withTrustedContext(
      new Request("https://conversation.internal/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          appendMessageCommandSchema.parse({
            commandId: crypto.randomUUID(),
            protocolVersion: 1,
            occurredAt: new Date().toISOString(),
            payload: {
              messageId,
              conversationId,
              body,
              mentions: [],
              components: [],
            },
          }),
        ),
      }),
      {
        principal: ctx.principal,
        requestId: crypto.randomUUID(),
        workspaceId: ctx.workspaceId,
        conversationId,
      },
    ),
  );
  expect(response.status).toBe(200);
  return messageId;
}

export async function appendRootMessage(ctx: ChannelTestContext) {
  return appendConversationMessage(ctx, "mission-control", "Thread root");
}

export function channelEnvelope(payload: JsonObject) {
  return {
    commandId: crypto.randomUUID(),
    protocolVersion: 1,
    occurredAt: new Date().toISOString(),
    payload,
  };
}

function workspaceStub(ctx: ChannelTestContext) {
  const workspaces = ctx.env.WORKSPACES;
  return workspaces.get(workspaces.idFromName(ctx.workspaceId));
}
