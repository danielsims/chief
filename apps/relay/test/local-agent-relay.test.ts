import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { expect, it } from "vitest";

import { agentIdSchema } from "@chief/relay-contracts";

import {
  createNip98Authorization,
  nip98PublicKey,
  RelayClient,
} from "../../../packages/relay-client/src/index";
import worker from "../src/index";
import {
  channelEnvelope,
  channelRpc,
  dispatchTestMessage,
  registerTestAgent,
  setupChannelTest,
} from "./channel-test-helpers";

it("runs a custom local agent through account-mode relay authentication, activity, and DM completion", async () => {
  const ctx = await setupChannelTest();
  const agentId = agentIdSchema.parse("on-device");
  const secret = "12".repeat(32);
  const created = await channelRpc(ctx, ctx.principal, "agent-create", {
    agentId,
    name: "On Device",
    role: "Engineer",
    description: "Local engineering",
    instructions: "Work on this Mac.",
  });
  expect(created.status).toBe(200);
  expect(
    (await registerTestAgent(ctx, agentId, nip98PublicKey(secret))).status,
  ).toBe(200);
  const environment = { ...ctx.env, ACCOUNT_IDENTITY_MODE: "chief-account" };
  const client = new RelayClient({
    relayUrl: "https://relay.test",
    workspaceId: ctx.workspaceId,
    getAuthorization: (request) =>
      Promise.resolve(createNip98Authorization(secret, request)),
    fetch: async (input, init) => {
      const execution = createExecutionContext();
      const response = await worker.fetch(
        new Request(input, init),
        environment,
        execution,
      );
      await waitOnExecutionContext(execution);
      return response;
    },
  });
  await expect(client.activeWorkspace()).rejects.toMatchObject({ status: 401 });
  await expect(client.loadOwnAgentProfile()).resolves.toMatchObject({
    id: agentId,
    instructions: "Work on this Mac.",
  });
  await expect(
    client.forWorkspace("unrelated-workspace").loadOwnAgentProfile(),
  ).rejects.toMatchObject({ status: 403 });

  const direct = await channelRpc(
    ctx,
    ctx.principal,
    "directs-start",
    channelEnvelope({ participant: { kind: "agent", principalId: agentId } }),
  );
  const { directStartResultSchema } = await import("@chief/relay-contracts");
  const conversationId = directStartResultSchema.parse(await direct.json())
    .conversation.id;
  expect(
    (
      await dispatchTestMessage(ctx, ctx.principal, {
        id: crypto.randomUUID(),
        conversationId,
        body: "Please inspect this feature.",
        components: [],
        mentions: [],
        author: {
          kind: "user",
          id: ctx.principal.userId,
          pubkey: ctx.principal.pubkey,
        },
        workspaceId: ctx.workspaceId,
        sequence: 1,
        createdAt: new Date().toISOString(),
      })
    ).status,
  ).toBe(200);
  const lease = await client.claimAgentJob(agentId, "local-test");
  expect(lease).not.toBeNull();
  if (!lease) throw new Error("No job was queued for the local agent.");
  await client.upsertAgentActivity(conversationId, {
    messageId: crypto.randomUUID(),
    component: {
      id: crypto.randomUUID(),
      kind: "tool",
      version: 1,
      payload: {
        name: "inspect",
        status: "completed",
        output: "Read the feature.",
      },
    },
  });
  await client.completeAgentJob(agentId, {
    leaseToken: lease.leaseToken,
    outcome: {
      status: "completed",
      result: {
        publishedMessage: {
          conversationId,
          body: "Feature inspected.",
          components: [],
        },
      },
    },
  });
  const messages = await client.listMessages(conversationId);
  expect(messages.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        body: "Feature inspected.",
        author: expect.objectContaining({ id: agentId }),
      }),
      expect.objectContaining({
        components: expect.arrayContaining([
          expect.objectContaining({ kind: "tool" }),
        ]),
      }),
    ]),
  );
});
