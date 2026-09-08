import { afterEach, describe, expect, it, vi } from "vitest";

import {
  agentIdSchema,
  registerExternalAgentCommandSchema,
} from "@chief/relay-contracts";

import {
  activeTestSnapshot,
  dispatchTestMessage,
  ownerId,
  setupChannelTest,
} from "./channel-test-helpers";
import {
  receiveExternalAgent,
  registerExternalAgent,
  verifyExternalAgent,
  workspaceFetch,
} from "./external-agent-channel-helpers";

afterEach(() => vi.unstubAllGlobals());

describe("external agent channels", () => {
  it("prepares an existing deployment with the same credentials and keeps its live endpoint", async () => {
    const ctx = await setupChannelTest();
    const registered = await registerExternalAgent(ctx, {
      agentId: "eve-update",
    });
    await verifyExternalAgent(ctx, "eve-update");
    const prepare = (reuseExisting: boolean) =>
      workspaceFetch(
        ctx,
        "external-agent-register",
        registerExternalAgentCommandSchema.parse({
          commandId: crypto.randomUUID(),
          protocolVersion: 1,
          occurredAt: new Date().toISOString(),
          payload: {
            agentId: "eve-update",
            name: "Eve",
            role: "Engineer",
            endpoint: "https://replacement.vercel.app/channels/chief/messages",
            reuseExisting,
          },
        }),
        ctx.principal,
        `https://relay.test/v1/workspaces/${ctx.workspaceId}/agents/external`,
      );
    expect((await prepare(false)).status).toBe(409);
    const response = await prepare(true);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      channel: registered.channel,
    });
    expect((await activeTestSnapshot(ctx)).agents).toContainEqual(
      expect.objectContaining({
        id: "eve-update",
        runtime: expect.objectContaining({
          endpoint: "https://chief-agent.vercel.app/channels/chief/messages",
          connectionStatus: "connected",
        }),
      }),
    );
  });
  it("registers an Eve runtime with Project-backed definition provenance", async () => {
    const ctx = await setupChannelTest();
    const projectResponse = await workspaceFetch(
      ctx,
      "data-project-create",
      {
        name: "Chief agent",
        repositoryKind: "cloned",
        providerId: "github",
        canonicalRemoteUrl: "https://github.com/test-workspace/chief-agent.git",
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

  it("connects messaging from the registered channel without fetching the Eve deployment", async () => {
    const ctx = await setupChannelTest();
    await registerExternalAgent(ctx, { agentId: "eve-pending" });
    expect((await activeTestSnapshot(ctx)).agents).toContainEqual(
      expect.objectContaining({
        id: "eve-pending",
        runtime: expect.objectContaining({ connectionStatus: "pending_setup" }),
      }),
    );
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const response = await workspaceFetch(
      ctx,
      "external-agent-verify",
      {},
      ctx.principal,
      `https://relay.test/v1/workspaces/${ctx.workspaceId}/agents/eve-pending/external/verify`,
    );
    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await activeTestSnapshot(ctx)).agents).toContainEqual(
      expect.objectContaining({
        id: "eve-pending",
        runtime: expect.objectContaining({ connectionStatus: "connected" }),
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
        people: expect.arrayContaining([
          expect.objectContaining({ id: ownerId, role: "owner" }),
        ]),
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

  it("keeps a native agent active until its Eve replacement is verified", async () => {
    const ctx = await setupChannelTest();
    const before = (await activeTestSnapshot(ctx)).agents.find(
      (agent) => agent.id === "chief",
    );
    expect(before?.runtime).toEqual({ kind: "native-cell" });

    await registerExternalAgent(ctx, {
      agentId: "chief",
      replaceNative: true,
    });
    expect((await activeTestSnapshot(ctx)).agents).toContainEqual(before);

    const endpoint =
      "https://chief-deployment-abc.vercel.app/channels/chief/messages";
    const updated = await workspaceFetch(
      ctx,
      "external-agent-endpoint",
      { endpoint },
      ctx.principal,
      `https://relay.test/v1/workspaces/${ctx.workspaceId}/agents/chief/external/endpoint`,
    );
    expect(updated.status).toBe(200);
    expect((await activeTestSnapshot(ctx)).agents).toContainEqual(before);

    await verifyExternalAgent(ctx, "chief", ["github.com", "notion.so"]);
    const connected = await activeTestSnapshot(ctx);
    expect(connected.selectedApps).toEqual(["github.com", "notion.so"]);
    expect(connected.agents).toContainEqual(
      expect.objectContaining({
        id: "chief",
        runtime: expect.objectContaining({
          kind: "external-channel",
          endpoint,
          connectionStatus: "connected",
        }),
      }),
    );

    const disconnected = await workspaceFetch(
      ctx,
      "external-agent-disconnect",
      {},
      ctx.principal,
      `https://relay.test/v1/workspaces/${ctx.workspaceId}/agents/chief/external`,
      undefined,
      "DELETE",
    );
    expect(disconnected.status).toBe(200);
    expect((await activeTestSnapshot(ctx)).agents).toContainEqual({
      ...before,
      runtime: { kind: "native-cell" },
    });
  });
});
