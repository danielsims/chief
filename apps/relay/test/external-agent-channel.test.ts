import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ExternalAgentInboundActivity,
  ExternalAgentInboundMessage,
} from "@chief/relay-contracts";
import {
  agentIdSchema,
  externalAgentRegistrationResultSchema,
  registerExternalAgentCommandSchema,
} from "@chief/relay-contracts";

import { EXTERNAL_CHANNEL_AUTHORIZATION_HEADER } from "../src/external-agent-channel-security";
import { withTrustedContext } from "../src/internal-context";
import {
  activeTestSnapshot,
  appendRootMessage,
  dispatchTestMessage,
  ownerId,
  setupChannelTest,
  testConversationMessages,
} from "./channel-test-helpers";

afterEach(() => vi.unstubAllGlobals());

describe("external agent channels", () => {
  it("registers an Eve runtime with Project-backed definition provenance", async () => {
    const ctx = await setupChannelTest();
    const projectResponse = await workspaceFetch(
      ctx,
      "data-project-create",
      {
        name: "Chief agent",
        repositoryKind: "cloned",
        providerId: "github",
        canonicalRemoteUrl: "https://github.com/danielsims/chief-agent.git",
        defaultBranch: "main",
      },
      ctx.principal,
      "https://relay.test/projects",
    );
    const project = (await projectResponse.json()) as { id: string };
    const commandId = crypto.randomUUID();
    const registered = await registerExternalAgent(ctx, {
      agentId: "eve-engineer",
      commandId,
      definition: {
        kind: "project-repository",
        projectId: project.id,
        path: "agent",
        ref: "main",
      },
    });
    const repeated = await registerExternalAgent(ctx, {
      agentId: "eve-engineer",
      commandId,
      definition: {
        kind: "project-repository",
        projectId: project.id,
        path: "agent",
        ref: "main",
      },
    });

    expect(repeated.channel.token).toBe(registered.channel.token);
    const conflictingCommand = registerExternalAgentCommandSchema.parse({
      commandId,
      protocolVersion: 1,
      occurredAt: new Date().toISOString(),
      payload: {
        agentId: "eve-engineer",
        name: "Eve Engineer",
        role: "Different role",
        endpoint: "https://chief-agent.vercel.app/channels/chief/messages",
      },
    });
    const conflict = await workspaceFetch(
      ctx,
      "external-agent-register",
      conflictingCommand,
      ctx.principal,
      `https://relay.test/v1/workspaces/${ctx.workspaceId}/agents/external`,
    );
    expect(conflict.status).toBe(409);
    expect((await activeTestSnapshot(ctx)).agents).toContainEqual(
      expect.objectContaining({
        id: "eve-engineer",
        runtime: expect.objectContaining({
          kind: "external-channel",
          provider: "eve",
          endpoint: "https://chief-agent.vercel.app/channels/chief/messages",
          connectionStatus: "pending_setup",
          definition: expect.objectContaining({
            kind: "repository",
            projectId: project.id,
            path: "agent",
            requestedRef: "main",
            verification: expect.objectContaining({
              status: expect.stringMatching(/verified|unresolved/u),
            }),
          }),
          deployment: { status: "unattested" },
        }),
      }),
    );
  });

  it("keeps delivery disabled until Eve proves the configured identity", async () => {
    const ctx = await setupChannelTest();
    await registerExternalAgent(ctx, { agentId: "eve-pending" });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json({
          status: "ready",
          agentId: "eve-pending",
          workspaceId: "another-workspace",
        }),
      ),
    );
    const response = await workspaceFetch(
      ctx,
      "external-agent-verify",
      {},
      ctx.principal,
      `https://relay.test/v1/workspaces/${ctx.workspaceId}/agents/eve-pending/external/verify`,
    );
    expect(response.status).toBe(409);
    expect((await activeTestSnapshot(ctx)).agents).toContainEqual(
      expect.objectContaining({
        id: "eve-pending",
        runtime: expect.objectContaining({ connectionStatus: "pending_setup" }),
      }),
    );
  });

  it("binds each credential and rejects unissued continuations", async () => {
    const ctx = await setupChannelTest();
    const first = await registerExternalAgent(ctx, { agentId: "eve-first" });
    const second = await registerExternalAgent(ctx, {
      agentId: "eve-second",
    });
    const delivery = {
      deliveryId: crypto.randomUUID(),
      continuation: {
        capability: "a".repeat(43),
      },
      sessionId: "eve-session-1",
      body: "The external agent completed the work.",
    };

    const impersonation = await receiveExternalAgent(
      ctx,
      "eve-second",
      first.channel.token,
      delivery,
    );
    expect(impersonation.status).toBe(401);

    const rejected = await receiveExternalAgent(
      ctx,
      "eve-second",
      second.channel.token,
      delivery,
    );
    expect(rejected.status).toBe(403);
  });

  it("delivers one queued Eve turn with stable continuation metadata", async () => {
    const ctx = await setupChannelTest();
    const registered = await registerExternalAgent(ctx, {
      agentId: "eve-reviewer",
    });
    await verifyExternalAgent(ctx, "eve-reviewer");
    const rootId = crypto.randomUUID();
    const deliveredBodies: unknown[] = [];
    let deliveredAuthorization: string | null = null;
    const deliveryFetch = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(request.url).toBe(
        "https://chief-agent.vercel.app/channels/chief/messages",
      );
      deliveredBodies.push(await request.json());
      deliveredAuthorization = request.headers.get("authorization");
      return Response.json({ status: "accepted", sessionId: "eve-session-2" });
    });
    vi.stubGlobal("fetch", deliveryFetch);
    const message = {
      id: rootId,
      workspaceId: ctx.workspaceId,
      conversationId: "mission-control",
      author: { kind: "user" as const, id: ownerId },
      body: "@Eve Reviewer please inspect this.",
      mentions: [agentIdSchema.parse("eve-reviewer")],
      components: [],
      reactions: [],
      edited: false,
      deleted: false,
      createdAt: new Date().toISOString(),
      sequence: 1,
    };

    const first = await dispatchTestMessage(ctx, ctx.principal, message);
    const replay = await dispatchTestMessage(ctx, ctx.principal, message);
    const followup = await dispatchTestMessage(ctx, ctx.principal, {
      ...message,
      id: crypto.randomUUID(),
      threadRootId: rootId,
      body: "@Eve Reviewer one more detail.",
      sequence: 2,
    });
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(followup.status).toBe(200);
    await vi.waitFor(() => expect(deliveryFetch).toHaveBeenCalledTimes(2));
    expect(deliveredAuthorization).toBe(`Bearer ${registered.channel.token}`);
    expect(deliveredBodies[0]).toMatchObject({
      protocolVersion: 1,
      payload: {
        sessionAddress: expect.stringMatching(/^chief_[a-f\d]{64}$/u),
        continuation: {
          capability: expect.any(String),
        },
        message: { id: rootId, body: message.body },
      },
    });
    expect(
      (deliveredBodies[1] as { payload: { sessionAddress: string } }).payload
        .sessionAddress,
    ).toBe(
      (deliveredBodies[0] as { payload: { sessionAddress: string } }).payload
        .sessionAddress,
    );
  });

  it("disconnects an external runtime without leaving it in the workspace", async () => {
    const ctx = await setupChannelTest();
    await registerExternalAgent(ctx, { agentId: "eve-temporary" });
    const response = await workspaceFetch(
      ctx,
      "external-agent-disconnect",
      {},
      ctx.principal,
      `https://relay.test/v1/workspaces/${ctx.workspaceId}/agents/eve-temporary/external`,
      undefined,
      "DELETE",
    );
    expect(response.status).toBe(200);
    expect((await activeTestSnapshot(ctx)).agents).not.toContainEqual(
      expect.objectContaining({ id: "eve-temporary" }),
    );
  });

  it("atomically rotates an external channel credential", async () => {
    const ctx = await setupChannelTest();
    const registered = await registerExternalAgent(ctx, {
      agentId: "eve-rotated",
    });
    const response = await workspaceFetch(
      ctx,
      "external-agent-rotate",
      {},
      ctx.principal,
      `https://relay.test/v1/workspaces/${ctx.workspaceId}/agents/eve-rotated/external/credentials/rotate`,
    );
    expect(response.status).toBe(200);
    const rotated = (await response.json()) as {
      channel: {
        token: string;
        inboundUrl: string;
        deliverySigningKeyId: string;
        deliverySigningSecret: string;
      };
    };
    expect(rotated.channel.token).not.toBe(registered.channel.token);
    expect(rotated.channel.inboundUrl).toBe(registered.channel.inboundUrl);
    expect(rotated.channel.deliverySigningKeyId).not.toBe(
      registered.channel.deliverySigningKeyId,
    );
    expect(rotated.channel.deliverySigningSecret).not.toBe(
      registered.channel.deliverySigningSecret,
    );
    expect(registered.channel.deliverySigningKeyId).toMatch(/^dsk_/u);
    expect(registered.channel.deliverySigningSecret).toHaveLength(43);

    const oldCredential = await receiveExternalAgent(
      ctx,
      "eve-rotated",
      registered.channel.token,
      {
        deliveryId: "delivery-after-rotation",
        continuation: {
          capability:
            "invalid-capability-that-is-long-enough-to-pass-the-schema-0001",
        },
        sessionId: "eve-session",
        body: "This credential is obsolete.",
      },
    );
    expect(oldCredential.status).toBe(401);
  });

  it("routes dead-letter requeue through an authenticated workspace administrator", async () => {
    const ctx = await setupChannelTest();
    const response = await workspaceFetch(
      ctx,
      "external-agent-requeue",
      {},
      ctx.principal,
      `https://relay.test/v1/workspaces/${ctx.workspaceId}/agents/eve/channel/deliveries/delivery-1/requeue`,
    );
    expect(response.status).toBe(404);
  });

  it("continues the issued thread once and deduplicates the inbound delivery", async () => {
    const ctx = await setupChannelTest();
    const registered = await registerExternalAgent(ctx, {
      agentId: "eve-threaded",
    });
    await verifyExternalAgent(ctx, "eve-threaded");
    const rootId = await appendRootMessage(ctx);
    const delivered: {
      current: { payload: { continuation: { capability: string } } } | null;
    } = { current: null };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        delivered.current = (await new Request(
          input,
          init,
        ).json()) as NonNullable<typeof delivered.current>;
        return Response.json({
          status: "accepted",
          sessionId: "eve-thread-session",
        });
      }),
    );
    const triggerId = crypto.randomUUID();
    await dispatchTestMessage(ctx, ctx.principal, {
      id: triggerId,
      workspaceId: ctx.workspaceId,
      conversationId: "mission-control",
      threadRootId: rootId,
      author: { kind: "user", id: ownerId },
      body: "@Eve Threaded continue here.",
      mentions: [agentIdSchema.parse("eve-threaded")],
      components: [],
      reactions: [],
      edited: false,
      deleted: false,
      createdAt: new Date().toISOString(),
      sequence: 2,
    });
    await vi.waitFor(() => expect(delivered.current).not.toBeNull());
    if (!delivered.current) throw new Error("Expected an external delivery.");
    const inbound = {
      deliveryId: crypto.randomUUID(),
      continuation: delivered.current.payload.continuation,
      sessionId: "eve-thread-session",
      body: "Threaded result from Eve.",
    };
    const accepted = await receiveExternalAgent(
      ctx,
      "eve-threaded",
      registered.channel.token,
      inbound,
    );
    const duplicate = await receiveExternalAgent(
      ctx,
      "eve-threaded",
      registered.channel.token,
      inbound,
    );

    expect(accepted.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ duplicate: true });
    const messages = await testConversationMessages(
      ctx,
      ctx.principal,
      "mission-control",
    );
    expect(
      messages.filter((message) => message.body === inbound.body),
    ).toHaveLength(1);
  });

  it("streams Eve activity into one stable conversation message", async () => {
    const ctx = await setupChannelTest();
    const registered = await registerExternalAgent(ctx, {
      agentId: "eve-streaming",
    });
    await verifyExternalAgent(ctx, "eve-streaming");
    const delivered: {
      current: { payload: { continuation: { capability: string } } } | null;
    } = { current: null };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        delivered.current = (await new Request(
          input,
          init,
        ).json()) as NonNullable<typeof delivered.current>;
        return Response.json({
          status: "accepted",
          sessionId: "eve-stream-session",
        });
      }),
    );
    await dispatchTestMessage(ctx, ctx.principal, {
      id: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
      conversationId: "mission-control",
      author: { kind: "user", id: ownerId },
      body: "@Eve Streaming inspect this.",
      mentions: [agentIdSchema.parse("eve-streaming")],
      components: [],
      reactions: [],
      edited: false,
      deleted: false,
      createdAt: new Date().toISOString(),
      sequence: 1,
    });
    await vi.waitFor(() => expect(delivered.current).not.toBeNull());
    if (!delivered.current) throw new Error("Expected an external delivery.");
    const baseActivity = {
      deliveryId: crypto.randomUUID(),
      continuation: delivered.current.payload.continuation,
      sessionId: "eve-stream-session",
      component: {
        id: "reasoning:turn-1:0",
        kind: "thinking" as const,
        version: 1 as const,
        payload: {
          text: "Inspecting",
          status: "working" as const,
          providerSessionId: "eve-stream-session",
        },
      },
    };

    const working = await receiveExternalActivity(
      ctx,
      "eve-streaming",
      registered.channel.token,
      baseActivity,
    );
    const completed = await receiveExternalActivity(
      ctx,
      "eve-streaming",
      registered.channel.token,
      {
        ...baseActivity,
        component: {
          ...baseActivity.component,
          payload: {
            ...baseActivity.component.payload,
            text: "Inspecting the workspace.",
            status: "completed",
          },
        },
      },
    );

    expect(working.status).toBe(200);
    expect(completed.status).toBe(200);
    expect(await completed.json()).toEqual(await working.json());
    const messages = await testConversationMessages(
      ctx,
      ctx.principal,
      "mission-control",
    );
    const activityMessages = messages.filter(
      (message) => message.author.id === "eve-streaming" && !message.body,
    );
    expect(activityMessages).toHaveLength(1);
    expect(activityMessages[0]?.components).toEqual([
      expect.objectContaining({
        kind: "thinking",
        payload: expect.objectContaining({
          text: "Inspecting the workspace.",
          status: "completed",
        }),
      }),
    ]);
  });
});

type TestContext = Awaited<ReturnType<typeof setupChannelTest>>;

async function registerExternalAgent(
  ctx: TestContext,
  input: {
    agentId: string;
    commandId?: string;
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
      endpoint: "https://chief-agent.vercel.app/channels/chief/messages",
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

async function verifyExternalAgent(ctx: TestContext, agentId: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () =>
      Response.json({ status: "ready", agentId, workspaceId: ctx.workspaceId }),
    ),
  );
  const response = await workspaceFetch(
    ctx,
    "external-agent-verify",
    {},
    ctx.principal,
    `https://relay.test/v1/workspaces/${ctx.workspaceId}/agents/${agentId}/external/verify`,
  );
  expect(response.status).toBe(200);
}

function receiveExternalAgent(
  ctx: TestContext,
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

function receiveExternalActivity(
  ctx: TestContext,
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

type ExternalAgentTestRequest =
  | ExternalAgentInboundActivity
  | ExternalAgentInboundMessage
  | ReturnType<typeof registerExternalAgentCommandSchema.parse>
  | object;

function workspaceFetch(
  ctx: TestContext,
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
