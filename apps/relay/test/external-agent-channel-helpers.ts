import { expect } from "vitest";

import type {
  ExternalAgentInboundActivity,
  ExternalAgentInboundMessage,
  ExternalAgentToolCall,
} from "@chief/relay-contracts";
import {
  externalAgentRegistrationResultSchema,
  registerExternalAgentCommandSchema,
} from "@chief/relay-contracts";

import type { setupChannelTest } from "./channel-test-helpers";
import { EXTERNAL_CHANNEL_AUTHORIZATION_HEADER } from "../src/external-agent-channel-security";
import { withTrustedContext } from "../src/internal-context";

export type ExternalAgentChannelTestContext = Awaited<
  ReturnType<typeof setupChannelTest>
>;

export async function registerExternalAgent(
  ctx: ExternalAgentChannelTestContext,
  input: {
    agentId: string;
    commandId?: string;
    endpoint?: string;
    replaceNative?: boolean;
    definition?: {
      kind: "project-repository";
      projectId: string;
      path: string;
      ref: string;
    };
  },
) {
  const command = registerExternalAgentCommandSchema.parse({
    commandId: input.commandId ?? crypto.randomUUID(),
    protocolVersion: 1,
    occurredAt: new Date().toISOString(),
    payload: {
      agentId: input.agentId,
      name: input.agentId
        .split("-")
        .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
        .join(" "),
      role: "External specialist",
      endpoint:
        input.endpoint ??
        "https://chief-agent.vercel.app/channels/chief/messages",
      replaceNative: input.replaceNative ?? false,
      ...(input.definition ? { definition: input.definition } : undefined),
    },
  });
  const response = await workspaceFetch(
    ctx,
    "external-agent-register",
    command,
    ctx.principal,
    `https://relay.test/v1/workspaces/${ctx.workspaceId}/agents/external`,
  );
  expect([200, 201]).toContain(response.status);
  return externalAgentRegistrationResultSchema.parse(await response.json());
}

export async function verifyExternalAgent(
  ctx: ExternalAgentChannelTestContext,
  agentId: string,
  selectedApps?: readonly string[],
) {
  const response = await workspaceFetch(
    ctx,
    "external-agent-verify",
    { selectedApps },
    ctx.principal,
    `https://relay.test/v1/workspaces/${ctx.workspaceId}/agents/${agentId}/external/verify`,
  );
  expect(response.status).toBe(200);
}

export function receiveExternalAgent(
  ctx: ExternalAgentChannelTestContext,
  agentId: string,
  token: string,
  body: ExternalAgentInboundMessage,
) {
  return workspaceFetch(
    ctx,
    "external-agent-message",
    body,
    {
      kind: "service",
      service: "external-agent-channel",
      workspaceId: ctx.workspaceId,
    },
    `https://relay.test/v1/workspaces/${ctx.workspaceId}/agents/${agentId}/channel/messages`,
    { [EXTERNAL_CHANNEL_AUTHORIZATION_HEADER]: `Bearer ${token}` },
  );
}

export function receiveExternalActivity(
  ctx: ExternalAgentChannelTestContext,
  agentId: string,
  token: string,
  body: ExternalAgentInboundActivity,
) {
  return workspaceFetch(
    ctx,
    "external-agent-activity",
    body,
    {
      kind: "service",
      service: "external-agent-channel",
      workspaceId: ctx.workspaceId,
    },
    `https://relay.test/v1/workspaces/${ctx.workspaceId}/agents/${agentId}/channel/activity`,
    { [EXTERNAL_CHANNEL_AUTHORIZATION_HEADER]: `Bearer ${token}` },
  );
}

export function receiveExternalTool(
  ctx: ExternalAgentChannelTestContext,
  agentId: string,
  token: string,
  body: ExternalAgentToolCall,
) {
  return workspaceFetch(
    ctx,
    "external-agent-tools",
    body,
    {
      kind: "service",
      service: "external-agent-channel",
      workspaceId: ctx.workspaceId,
    },
    `https://relay.test/v1/workspaces/${ctx.workspaceId}/agents/${agentId}/channel/tools`,
    { [EXTERNAL_CHANNEL_AUTHORIZATION_HEADER]: `Bearer ${token}` },
  );
}

type ExternalAgentTestRequest =
  | ExternalAgentInboundActivity
  | ExternalAgentInboundMessage
  | ExternalAgentToolCall
  | ReturnType<typeof registerExternalAgentCommandSchema.parse>
  | object;

export function workspaceFetch(
  ctx: ExternalAgentChannelTestContext,
  operation: string,
  body: ExternalAgentTestRequest,
  principal: Parameters<typeof withTrustedContext>[1]["principal"],
  url: string,
  extraHeaders?: Record<string, string>,
  method = "POST",
) {
  return ctx.env.WORKSPACES.get(
    ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
  ).fetch(
    withTrustedContext(
      new Request(url, {
        method,
        headers: {
          "content-type": "application/json",
          "x-chief-internal-operation": operation,
          ...extraHeaders,
        },
        body: JSON.stringify(body),
      }),
      {
        principal,
        requestId: crypto.randomUUID(),
        workspaceId: ctx.workspaceId,
      },
    ),
  );
}
