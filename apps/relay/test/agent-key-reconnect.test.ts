import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { userIdSchema } from "@chief/relay-contracts";

import {
  createNip98Authorization,
  nip98PublicKey,
} from "../../../packages/relay-client/src/index";
import { deliverAgentMailboxSocketEvent } from "../src/agent-mailbox";
import { deliverConversationSocketEvent } from "../src/conversation-socket-delivery";
import worker from "../src/index";
import { withTrustedIdentity } from "../src/internal-context";
import { authorizeWorkspace } from "../src/workspace-authority";
import {
  channelEnvelope,
  channelRpc,
  registerTestAgent,
  setupChannelTest,
} from "./channel-test-helpers";
import { hexKey } from "./helpers";

async function fixture() {
  const ctx = await setupChannelTest();
  const oldKey = nip98PublicKey("12".repeat(32));
  const newKey = hexKey(`new-${ctx.workspaceId}`);
  expect((await registerTestAgent(ctx, "chief", oldKey)).status).toBe(200);
  const stub = ctx.env.WORKSPACES.get(
    ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
  );
  const register = (
    pubkey: string,
    previousPubkey?: string,
    identity = ctx.identity,
  ) =>
    stub.fetch(
      withTrustedIdentity(
        {
          identity,
          workspaceId: ctx.workspaceId,
          requestId: crypto.randomUUID(),
        },
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-chief-internal-operation": "register-agent-key",
          },
          body: JSON.stringify({ agentId: "chief", pubkey, previousPubkey }),
        },
      ),
    );
  const authorize = (pubkey: string) =>
    authorizeWorkspace(ctx.env, {
      identity: { kind: "user", userId: userIdSchema.parse(pubkey), pubkey },
      workspaceId: ctx.workspaceId,
      requestId: crypto.randomUUID(),
    });
  return { ctx, oldKey, newKey, register, authorize };
}

describe("agent identity reconnect", () => {
  it("requires an explicit replacement and supplies the current public key", async () => {
    const { register, oldKey, newKey, authorize } = await fixture();
    const conflict = await register(newKey);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: {
        code: "agent_key_already_registered",
        details: { pubkey: oldKey },
      },
    });
    await expect(authorize(oldKey)).resolves.toMatchObject({
      kind: "agent",
      agentId: "chief",
    });
  });

  it("reconnects idempotently, keeps membership and config, and revokes the old key", async () => {
    const { ctx, register, oldKey, newKey, authorize } = await fixture();
    const before = await (
      await channelRpc(ctx, ctx.principal, "agent-configs-list")
    ).json();
    expect((await register(newKey, oldKey)).status).toBe(200);
    expect((await register(newKey, oldKey)).status).toBe(200);
    expect(
      await (await channelRpc(ctx, ctx.principal, "agent-configs-list")).json(),
    ).toEqual(before);
    await expect(authorize(newKey)).resolves.toMatchObject({
      kind: "agent",
      agentId: "chief",
      role: "member",
    });
    await expect(authorize(oldKey)).rejects.toThrow();
  });

  it("rejects a stale replacement without changing the registered key", async () => {
    const { register, oldKey, newKey, authorize } = await fixture();
    expect((await register(newKey, hexKey("stale"))).status).toBe(409);
    await expect(authorize(oldKey)).resolves.toMatchObject({ kind: "agent" });
    await expect(authorize(newKey)).rejects.toThrow();
  });

  it("closes existing conversation sockets before delivering data to the old identity", async () => {
    const { ctx, register, oldKey, newKey, authorize } = await fixture();
    const principal = await authorize(oldKey);
    expect(
      (
        await channelRpc(
          ctx,
          ctx.principal,
          "channels-create",
          channelEnvelope({
            conversationId: "reconnect-private",
            name: "reconnect-private",
            isPrivate: true,
          }),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await channelRpc(
          ctx,
          ctx.principal,
          "channels-members-add",
          channelEnvelope({
            conversationId: "reconnect-private",
            kind: "agent",
            principalId: "chief",
          }),
        )
      ).status,
    ).toBe(200);
    const send = vi.fn();
    const close = vi.fn();
    const socket = {
      send,
      close,
      deserializeAttachment: () => ({
        principal,
        workspaceId: ctx.workspaceId,
        conversationId: "reconnect-private",
      }),
    };
    await deliverConversationSocketEvent(ctx.env, [socket], {
      text: "Before rotation",
    });
    expect(send).toHaveBeenCalledTimes(1);
    const mailbox = {
      send: vi.fn(),
      close: vi.fn(),
      deserializeAttachment: () => ({ principal }),
    };
    await deliverAgentMailboxSocketEvent(ctx.env, [mailbox], {
      type: "agent.job.available",
    });
    expect(mailbox.send).toHaveBeenCalledTimes(1);
    expect((await register(newKey, oldKey)).status).toBe(200);
    expect(
      (await channelRpc(ctx, principal, "authorize-agent-runtime")).status,
    ).toBe(403);
    await deliverConversationSocketEvent(ctx.env, [socket], {
      text: "After rotation",
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(1008, expect.any(String));
    await deliverAgentMailboxSocketEvent(ctx.env, [mailbox], {
      type: "agent.job.available",
    });
    expect(mailbox.send).toHaveBeenCalledTimes(1);
    expect(mailbox.close).toHaveBeenCalledWith(1008, expect.any(String));
  });

  it("rejects unsigned requests and agent-signed requests at the public recovery route", async () => {
    const { ctx, oldKey, newKey, authorize } = await fixture();
    const url = `https://relay.test/v1/workspaces/${ctx.workspaceId}/agents/chief/keys`;
    const body = JSON.stringify({
      agentId: "chief",
      pubkey: newKey,
      previousPubkey: oldKey,
    });
    for (const signed of [false, true]) {
      const execution = createExecutionContext();
      const headers = new Headers({ "content-type": "application/json" });
      if (signed)
        headers.set(
          "authorization",
          createNip98Authorization("12".repeat(32), {
            url,
            method: "POST",
            body,
          }),
        );
      const response = await worker.fetch(
        new Request(url, { method: "POST", headers, body }),
        ctx.env,
        execution,
      );
      await waitOnExecutionContext(execution);
      expect(response.status).toBe(signed ? 403 : 401);
    }
    await expect(authorize(oldKey)).resolves.toMatchObject({ kind: "agent" });
  });

  it("does not allow a non-owner to reconnect an agent", async () => {
    const { register, oldKey, newKey, authorize } = await fixture();
    const outsider = {
      kind: "user" as const,
      userId: userIdSchema.parse("outsider"),
      pubkey: hexKey("outsider"),
    };
    expect((await register(newKey, oldKey, outsider)).status).toBe(403);
    await expect(authorize(oldKey)).resolves.toMatchObject({ kind: "agent" });
  });

  it("does not let an owner reuse another agent's key", async () => {
    const { ctx, register, oldKey, newKey, authorize } = await fixture();
    expect((await registerTestAgent(ctx, "engineer", newKey)).status).toBe(200);
    const response = await register(newKey, oldKey);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "agent_key_reuse_denied" },
    });
    await expect(authorize(oldKey)).resolves.toMatchObject({
      agentId: "chief",
    });
  });
});
