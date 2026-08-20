import { env } from "cloudflare:workers";
import { expect } from "vitest";

import type { WorkspaceId } from "@chief/relay-contracts";
import {
  agentIdSchema,
  createWorkspaceCommandSchema,
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

export async function setupChannelTest(): Promise<ChannelTestContext> {
  const relay = env as unknown as Parameters<typeof createManagedWorkspace>[0];
  const identity = {
    kind: "user" as const,
    userId: ownerId,
    pubkey: hexKey(String(ownerId)),
  };
  const command = createWorkspaceCommandSchema.parse({
    commandId: crypto.randomUUID(),
    name: "Channel test",
    website: "https://heychief.sh",
    runtime: "phone" as const,
    inferenceProvider: "openCodeGo",
    inferenceModel: "deepseek-v4-flash",
    selectedApps: [],
  });
  const created = await createManagedWorkspace(relay, identity, command);
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
  body?: unknown,
  query?: string,
) {
  const headers = new Headers({ "x-chief-internal-operation": operation });
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
  const conversations = (
    ctx.env as unknown as { CONVERSATIONS: DurableObjectNamespace }
  ).CONVERSATIONS;
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
      author: { kind: string; id: string };
      body: string;
      components: Array<{ kind: string; payload: Record<string, unknown> }>;
    }>;
  };
  return page.messages;
}

export function channelEnvelope(payload: Record<string, unknown>) {
  return {
    commandId: crypto.randomUUID(),
    protocolVersion: 1,
    occurredAt: new Date().toISOString(),
    payload,
  };
}

function workspaceStub(ctx: ChannelTestContext) {
  const workspaces = (
    ctx.env as unknown as { WORKSPACES: DurableObjectNamespace }
  ).WORKSPACES;
  return workspaces.get(workspaces.idFromName(ctx.workspaceId));
}
