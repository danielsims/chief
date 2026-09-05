import { afterEach, describe, expect, it, vi } from "vitest";

import type { JsonObject } from "@chief/relay-contracts";
import {
  channelDetailSchema,
  externalAgentToolResultSchema,
  missionSchema,
  workspaceFileSchema,
  workspaceScheduleSchema,
} from "@chief/relay-contracts";

import {
  appendConversationMessage,
  channelEnvelope,
  channelRpc,
  dispatchTestMessage,
  ownerId,
  setupChannelTest,
  testConversationMessages,
} from "./channel-test-helpers";
import {
  receiveExternalTool,
  registerExternalAgent,
  verifyExternalAgent,
} from "./external-agent-channel-helpers";

afterEach(() => vi.unstubAllGlobals());

describe("external agent channel tools", () => {
  it("lets Eve call Chief channel tools with the issued continuation", async () => {
    const ctx = await setupChannelTest();
    const registered = await registerExternalAgent(ctx, {
      agentId: "eve-tools",
    });
    await verifyExternalAgent(ctx, "eve-tools");
    const direct = await channelRpc(
      ctx,
      ctx.principal,
      "directs-start",
      channelEnvelope({
        participant: { kind: "agent", principalId: "eve-tools" },
      }),
    );
    expect(direct.status).toBe(201);
    const conversationId = (
      (await direct.json()) as { conversation: { id: string } }
    ).conversation.id;
    const delivered: {
      current: {
        payload: {
          continuation: { capability: string };
          conversationId?: string;
          message: { id: string };
        };
      } | null;
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
          sessionId: "eve-tools-session",
        });
      }),
    );
    const triggerId = crypto.randomUUID();
    await appendConversationMessage(
      ctx,
      conversationId,
      "Please look at this.",
      triggerId,
    );
    await dispatchTestMessage(ctx, ctx.principal, {
      id: triggerId,
      workspaceId: ctx.workspaceId,
      conversationId,
      author: { kind: "user", id: ownerId },
      body: "Please look at this.",
      mentions: [],
      components: [],
      reactions: [],
      edited: false,
      deleted: false,
      createdAt: new Date().toISOString(),
      sequence: 1,
    });
    await vi.waitFor(() => expect(delivered.current).not.toBeNull());
    if (!delivered.current) throw new Error("Expected an external delivery.");
    expect(delivered.current.payload.conversationId).toBe(conversationId);
    expect(delivered.current.payload.message.id).toBe(triggerId);
    const continuation = delivered.current.payload.continuation;
    const invokeWorkspace = (operationId: string, input: JsonObject) =>
      receiveExternalTool(ctx, "eve-tools", registered.channel.token, {
        deliveryId: triggerId,
        continuation,
        sessionId: "eve-tools-session",
        operationId,
        input,
      });
    const createdResponse = await invokeWorkspace("channels.create", {
      name: "launch-mission",
      operationKey: "launch-mission-cell",
      visibility: "private",
    });
    expect(createdResponse.status).toBe(200);
    const createdChannel = channelDetailSchema.parse(
      externalAgentToolResultSchema.parse(await createdResponse.json()).result,
    ).channel;
    const invited = await invokeWorkspace("channels.members.add", {
      channelId: createdChannel.id,
      members: [
        { type: "user", id: ownerId },
        { type: "agent", id: "brand" },
      ],
      idempotencyKey: "invite-launch-team",
    });
    expect(invited.status).toBe(200);
    const write = await invokeWorkspace("files.write", {
      name: "Launch brief",
      content: "# Launch brief",
      conversationId: createdChannel.id,
    });
    expect(write.status).toBe(200);
    const savedFile = workspaceFileSchema.parse(
      externalAgentToolResultSchema.parse(await write.json()).result.file,
    );
    const revise = await invokeWorkspace("files.write", {
      id: savedFile.id,
      name: savedFile.title,
      content: "# Revised launch brief",
      expectedVersionId: String(savedFile.version),
    });
    expect(revise.status).toBe(200);
    const read = await invokeWorkspace("files.read", { fileId: savedFile.id });
    expect(
      workspaceFileSchema.parse(
        externalAgentToolResultSchema.parse(await read.json()).result.file,
      ),
    ).toMatchObject({
      content: "# Revised launch brief",
      path: savedFile.path,
      conversationId: createdChannel.id,
      version: 2,
    });
    const presented = await invokeWorkspace("channels.messages.post", {
      channelId: createdChannel.id,
      content: "The launch brief is ready.",
      artifactIds: [savedFile.id],
    });
    expect(presented.status).toBe(200);
    const channelMessages = await testConversationMessages(
      ctx,
      ctx.principal,
      createdChannel.id,
    );
    expect(
      channelMessages.some((message) =>
        message.components.some(
          (component) =>
            component.kind === "artifact.reference" &&
            component.payload.fileId === savedFile.id &&
            component.payload.version === 2,
        ),
      ),
    ).toBe(true);
    const wrongChannel = await invokeWorkspace("channels.messages.post", {
      channelId: conversationId,
      content: "Private file",
      artifactIds: [savedFile.id],
    });
    expect(wrongChannel.status).toBeGreaterThanOrEqual(400);

    const missionResponse = await invokeWorkspace("missions.create", {
      id: "launch-conversion",
      conversationId: createdChannel.id,
      title: "Improve launch conversion",
      objective: "Measure and improve the signup page",
      ownerAgentId: "eve-tools",
      collaborators: ["brand"],
      success: {
        kind: "metric",
        name: "Signups",
        unit: "percent",
        direction: "increase",
        baseline: 2,
        target: 5,
        source: "Verified signup analytics",
        evaluationWindow: "Seven days",
      },
      maxExperiments: 4,
      deadline: new Date(Date.now() + 86400000).toISOString(),
      constraints: "Do not publish changes without review.",
    });
    expect(missionResponse.status).toBe(200);
    const mission = missionSchema.parse(
      externalAgentToolResultSchema.parse(await missionResponse.json()).result,
    );
    const experiment = await invokeWorkspace("missions.recordExperiment", {
      missionId: mission.id,
      id: "headline-test",
      hypothesis: "Clearer copy increases signups",
      change: "Tested a clearer heading",
      value: 3,
      evidence: "Three signups per hundred visitors",
      decision: "keep",
    });
    expect(experiment.status).toBe(200);
    const proposalInput = {
      id: "launch-weekly",
      conversationId: createdChannel.id,
      agentId: "eve-tools",
      missionId: mission.id,
      title: "Measure launch performance",
      instructions: "Read the current analytics and publish a report",
      cron: "0 9 * * 1",
      timezone: "Australia/Brisbane",
      approvalSummary: "Weekly report in the launch channel",
      proposedToolPatterns: [],
    };
    const proposed = await invokeWorkspace(
      "recurringWork.propose",
      proposalInput,
    );
    expect(proposed.status).toBe(200);
    expect(
      workspaceScheduleSchema.parse(
        externalAgentToolResultSchema.parse(await proposed.json()).result,
      ).status,
    ).toBe("needs_approval");
    expect(
      (
        await invokeWorkspace("recurringWork.propose", {
          ...proposalInput,
          activate: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await invokeWorkspace("recurringWork.activate", {
          id: proposalInput.id,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await invokeWorkspace("plugins.install", {
          pluginId: "arbitrary-plugin",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await invokeWorkspace("missions.updateStatus", {
          missionId: mission.id,
          status: "paused",
          evidence: "Waiting for the next measurement window",
        })
      ).status,
    ).toBe(200);
    expect((await invokeWorkspace("missions.list", {})).status).toBe(200);
    expect((await invokeWorkspace("recurringWork.list", {})).status).toBe(200);

    const listed = await receiveExternalTool(
      ctx,
      "eve-tools",
      registered.channel.token,
      {
        deliveryId: triggerId,
        continuation,
        sessionId: "eve-tools-session",
        operationId: "channels.list",
        input: {},
      },
    );
    const reacted = await receiveExternalTool(
      ctx,
      "eve-tools",
      registered.channel.token,
      {
        deliveryId: triggerId,
        continuation,
        sessionId: "eve-tools-session",
        operationId: "channels.reactions.add",
        input: {
          channelId: conversationId,
          messageId: triggerId,
          emoji: "👀",
        },
      },
    );
    const posted = await receiveExternalTool(
      ctx,
      "eve-tools",
      registered.channel.token,
      {
        deliveryId: triggerId,
        continuation,
        sessionId: "eve-tools-session",
        operationId: "channels.messages.post",
        input: {
          channelId: conversationId,
          content: "I see it. What should we do next?",
        },
      },
    );

    expect(listed.status).toBe(200);
    expect(reacted.status).toBe(200);
    expect(posted.status).toBe(200);
    const listedBody = (await listed.json()) as {
      result: { channels: { id: string }[] };
    };
    expect(listedBody.result.channels.length).toBeGreaterThan(0);
    const messages = await testConversationMessages(
      ctx,
      ctx.principal,
      conversationId,
    );
    const trigger = messages.find((message) => message.id === triggerId);
    expect(trigger?.reactions).toEqual(
      expect.arrayContaining([expect.objectContaining({ emoji: "👀" })]),
    );
    expect(
      messages.some(
        (message) => message.body === "I see it. What should we do next?",
      ),
    ).toBe(true);
  });
});
