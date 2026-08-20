import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { WorkspaceId } from "@chief/relay-contracts";
import {
  agentIdSchema,
  agentLeaseSchema,
  appendMessageCommandSchema,
  createWorkspaceCommandSchema,
  messagePageSchema,
  userIdSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import {
  withTrustedContext,
  withTrustedIdentity,
} from "../src/internal-context";
import {
  activeManagedWorkspace,
  createManagedWorkspace,
  listManagedWorkspaces,
  switchManagedWorkspace,
} from "../src/workspace-authority";
import { hexKey } from "./helpers";

describe("managed workspace onboarding", () => {
  it("creates an account workspace and durably queues Chief setup", async () => {
    const relay = env as unknown as Parameters<
      typeof createManagedWorkspace
    >[0];
    const identity = {
      kind: "user" as const,
      userId: userIdSchema.parse("managed-owner"),
      pubkey: hexKey("managed-owner"),
    };
    const command = createWorkspaceCommandSchema.parse({
      commandId: "3384c105-6bf9-443f-b447-0898cfa40d48",
      name: "Chief QA",
      website: "https://heychief.sh",
      runtime: "phone" as const,
      inferenceProvider: "openCodeGo",
      inferenceModel: "deepseek-v4-flash",
      selectedApps: ["github", "notion"],
    });

    const created = await createManagedWorkspace(relay, identity, command);
    const snapshot = workspaceSnapshotSchema.parse(await created.json());
    const active = await activeManagedWorkspace(relay, identity);
    const activeSnapshot = workspaceSnapshotSchema.parse(await active.json());
    const principal = {
      kind: "user" as const,
      userId: identity.userId,
      pubkey: identity.pubkey,
      workspaceId: snapshot.id,
      role: "owner" as const,
    };
    const chiefPubkey = hexKey("managed-owner-chief");
    const workspace = relay.WORKSPACES.get(
      relay.WORKSPACES.idFromName(snapshot.id),
    );
    const registered = await workspace.fetch(
      withTrustedIdentity(
        {
          identity,
          requestId: crypto.randomUUID(),
          workspaceId: snapshot.id,
        },
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-chief-internal-operation": "register-agent-key",
          },
          body: JSON.stringify({ agentId: "chief", pubkey: chiefPubkey }),
        },
      ),
    );
    const chief = {
      kind: "agent" as const,
      agentId: agentIdSchema.parse("chief"),
      pubkey: chiefPubkey,
      workspaceId: snapshot.id,
    };
    for (const specialistId of ["brand", "prospector", "engineer"] as const) {
      const response = await workspace.fetch(
        withTrustedIdentity(
          {
            identity,
            requestId: crypto.randomUUID(),
            workspaceId: snapshot.id,
          },
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-chief-internal-operation": "register-agent-key",
            },
            body: JSON.stringify({
              agentId: specialistId,
              pubkey: hexKey(`managed-owner-${specialistId}`),
            }),
          },
        ),
      );
      expect(response.status).toBe(200);
    }
    const delegation = await performChiefDelegation({
      relay,
      workspace,
      workspaceId: snapshot.id,
      chief,
    });
    const agent = relay.AGENTS.get(
      relay.AGENTS.idFromName(`${snapshot.id}:chief`),
    );
    const ownerClaim = await agent.fetch(
      withTrustedContext(
        new Request("https://agent.internal/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workerId: "owner", leaseSeconds: 60 }),
        }),
        {
          principal,
          requestId: crypto.randomUUID(),
          workspaceId: snapshot.id,
        },
      ),
    );
    const lease = await agent.fetch(
      withTrustedContext(
        new Request("https://agent.internal/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workerId: "iphone-test", leaseSeconds: 60 }),
        }),
        {
          principal: chief,
          requestId: crypto.randomUUID(),
          workspaceId: snapshot.id,
        },
      ),
    );
    const leaseBody = agentLeaseSchema.parse(await lease.clone().json());
    const completed = await agent.fetch(
      withTrustedContext(
        new Request("https://agent.internal/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            leaseToken: leaseBody.leaseToken,
            outcome: {
              status: "completed",
              result: {
                openingMessage: delegation.openingMessage,
                publishedMessage: {
                  conversationId: "mission-control",
                  body: delegation.openingMessage,
                  components: delegation.components,
                },
              },
            },
          }),
        }),
        {
          principal: chief,
          requestId: crypto.randomUUID(),
          workspaceId: snapshot.id,
        },
      ),
    );
    const finalized = await activeManagedWorkspace(relay, identity);
    const finalizedSnapshot = workspaceSnapshotSchema.parse(
      await finalized.json(),
    );
    const conversation = relay.CONVERSATIONS.get(
      relay.CONVERSATIONS.idFromName(`${snapshot.id}:mission-control`),
    );
    const messages = await conversation.fetch(
      withTrustedContext(
        new Request("https://conversation.internal/messages"),
        {
          principal,
          requestId: crypto.randomUUID(),
          workspaceId: snapshot.id,
          conversationId: "mission-control",
        },
      ),
    );
    const messagePage = messagePageSchema.parse(await messages.json());

    expect(created.status).toBe(200);
    expect(snapshot.agents).toContainEqual(
      expect.objectContaining({ id: "chief", status: "working" }),
    );
    expect(activeSnapshot.id).toBe(snapshot.id);
    expect(registered.status).toBe(200);
    expect(ownerClaim.status).toBe(403);
    expect(lease.status).toBe(200);
    expect(leaseBody).toMatchObject({
      job: { kind: "workspace.onboarding", agentId: "chief" },
    });
    expect(completed.status).toBe(200);
    expect(finalizedSnapshot.onboardingComplete).toBe(true);
    expect(finalizedSnapshot.agents).toContainEqual(
      expect.objectContaining({ id: "chief", status: "idle" }),
    );
    expect(finalizedSnapshot.conversations[0]).toMatchObject({
      id: "mission-control",
      lastMessage: expect.stringContaining("@Engineer"),
    });
    expect(messagePage.messages[0]).toMatchObject({
      author: { kind: "agent", id: "chief" },
      body: delegation.openingMessage,
    });
    expect(messagePage.messages).toHaveLength(7);
  });

  it("lists multiple workspaces and switches the active one", async () => {
    const relay = env as unknown as Parameters<
      typeof createManagedWorkspace
    >[0];
    const identity = {
      kind: "user" as const,
      userId: userIdSchema.parse("multi-owner"),
      pubkey: hexKey("multi-owner"),
    };
    const make = (commandId: string, name: string) =>
      createManagedWorkspace(
        relay,
        identity,
        createWorkspaceCommandSchema.parse({
          commandId,
          name,
          website: "https://heychief.sh",
          runtime: "phone" as const,
          inferenceProvider: "openCodeGo",
          inferenceModel: "deepseek-v4-flash",
          selectedApps: [],
        }),
      );

    const first = await make("fca0ea44-e52b-48c6-9ad7-000000000001", "Alpha");
    const second = await make("fca0ea44-e52b-48c6-9ad7-000000000002", "Beta");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const alphaId = workspaceSnapshotSchema.parse(await first.json()).id;
    const betaId = workspaceSnapshotSchema.parse(await second.json()).id;

    const listed = await listManagedWorkspaces(relay, identity);
    expect(listed.status).toBe(200);
    const list = (await listed.json()) as {
      workspaces: Array<{
        id: string;
        name: string;
        isActive: boolean;
        onboardingComplete: boolean;
      }>;
    };
    expect(list.workspaces).toHaveLength(2);
    expect(list.workspaces.find((w) => w.id === betaId)).toMatchObject({
      name: "Beta",
      isActive: true,
    });

    const switched = await switchManagedWorkspace(relay, identity, alphaId);
    expect(switched.status).toBe(200);
    expect(await switched.json()).toMatchObject({
      workspaceId: alphaId,
      isActive: true,
    });

    const active = await activeManagedWorkspace(relay, identity);
    const activeSnapshot = workspaceSnapshotSchema.parse(await active.json());
    expect(activeSnapshot.id).toBe(alphaId);
  });
});

async function performChiefDelegation(input: {
  relay: Parameters<typeof createManagedWorkspace>[0];
  workspace: DurableObjectStub;
  workspaceId: WorkspaceId;
  chief: {
    kind: "agent";
    agentId: ReturnType<typeof agentIdSchema.parse>;
    pubkey: string;
    workspaceId: WorkspaceId;
  };
}) {
  const openingMessage =
    "Hey, welcome to Chief. I'm getting the team together now.";
  const components: Array<{
    id: string;
    kind: "tool";
    version: 1;
    payload: Record<string, unknown>;
  }> = [];
  const post = async (body: string) => {
    const messageId = crypto.randomUUID();
    const command = appendMessageCommandSchema.parse({
      commandId: crypto.randomUUID(),
      protocolVersion: 1,
      occurredAt: new Date().toISOString(),
      payload: {
        messageId,
        conversationId: "mission-control",
        body,
        mentions: [],
        components: [],
      },
    });
    const conversation = input.relay.CONVERSATIONS.get(
      input.relay.CONVERSATIONS.idFromName(
        `${input.workspaceId}:mission-control`,
      ),
    );
    const response = await conversation.fetch(
      withTrustedContext(
        new Request("https://conversation.internal/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(command),
        }),
        {
          principal: input.chief,
          requestId: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          conversationId: "mission-control",
        },
      ),
    );
    expect(response.status).toBe(200);
    components.push(
      toolComponent(
        "relay_message_post",
        {
          conversationId: "mission-control",
          body,
        },
        { messageId },
      ),
    );
    return messageId;
  };

  await post(openingMessage);
  for (const principalId of ["brand", "prospector", "engineer"]) {
    const command = {
      commandId: crypto.randomUUID(),
      protocolVersion: 1,
      occurredAt: new Date().toISOString(),
      payload: {
        conversationId: "mission-control",
        kind: "agent",
        principalId,
      },
    };
    const response = await input.workspace.fetch(
      withTrustedContext(
        new Request("https://workspace.internal/channels", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-chief-internal-operation": "channels-members-add",
          },
          body: JSON.stringify(command),
        }),
        {
          principal: input.chief,
          requestId: crypto.randomUUID(),
          workspaceId: input.workspaceId,
        },
      ),
    );
    expect(response.status).toBe(200);
    components.push(
      toolComponent("relay_channels_members_add", command.payload, {
        ok: true,
      }),
    );
  }
  await post("Hey @Marketer, start a useful working brand profile.");
  await post("Hey @Prospector, start looking for genuine buying signals.");
  await post(
    "Hey @Engineer, get oriented and prepare the Engineering workspace.",
  );
  return { openingMessage, components };
}

function toolComponent(
  name: string,
  toolInput: Record<string, unknown>,
  output: Record<string, unknown>,
) {
  return {
    id: crypto.randomUUID(),
    kind: "tool" as const,
    version: 1 as const,
    payload: {
      name,
      status: "completed",
      input: JSON.stringify(toolInput),
      output: JSON.stringify(output),
    },
  };
}
