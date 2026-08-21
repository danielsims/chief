import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { WorkspaceId } from "@chief/relay-contracts";
import {
  agentIdSchema,
  agentLeaseSchema,
  createWorkspaceCommandSchema,
  messagePageSchema,
  userIdSchema,
  workspaceListResultSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import {
  withTrustedAccountIdentity,
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
import { performChiefDelegation } from "./managed-workspace-test-helpers";

describe("managed workspace onboarding", () => {
  it("repairs a missing Chief onboarding job when an incomplete workspace opens", async () => {
    const relay = env as unknown as Parameters<
      typeof createManagedWorkspace
    >[0];
    const identity = {
      kind: "user" as const,
      userId: userIdSchema.parse("repair-owner"),
      pubkey: hexKey("repair-owner"),
    };
    const command = createWorkspaceCommandSchema.parse({
      commandId: "3384c105-6bf9-443f-b447-0898cfa40d49",
      name: "Repair me",
      website: "https://heychief.sh",
      runtime: "phone" as const,
      inferenceProvider: "openCodeGo",
      inferenceModel: "deepseek-v4-flash-free",
      selectedApps: [],
    });
    const account = relay.ACCOUNTS.get(
      relay.ACCOUNTS.idFromName(identity.userId),
    );
    const directoryResponse = await account.fetch(
      withTrustedAccountIdentity(identity, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chief-internal-operation": "create-workspace",
        },
        body: JSON.stringify(command),
      }),
    );
    const entry = (await directoryResponse.json()) as {
      workspaceId: WorkspaceId;
      command: typeof command;
    };
    const workspace = relay.WORKSPACES.get(
      relay.WORKSPACES.idFromName(entry.workspaceId),
    );
    await workspace.fetch(
      withTrustedIdentity(
        {
          identity,
          requestId: command.commandId,
          workspaceId: entry.workspaceId,
        },
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-chief-internal-operation": "create-managed",
          },
          body: JSON.stringify(command),
        },
      ),
    );

    const active = await activeManagedWorkspace(relay, identity);
    const chiefPubkey = hexKey("repair-owner-chief");
    await workspace.fetch(
      withTrustedIdentity(
        {
          identity,
          requestId: crypto.randomUUID(),
          workspaceId: entry.workspaceId,
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
    const agent = relay.AGENTS.get(
      relay.AGENTS.idFromName(`${entry.workspaceId}:chief`),
    );
    const firstLease = await agent.fetch(
      withTrustedContext(
        new Request("https://agent.internal/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workerId: "iphone-test", leaseSeconds: 60 }),
        }),
        {
          principal: {
            kind: "agent",
            agentId: agentIdSchema.parse("chief"),
            pubkey: chiefPubkey,
            workspaceId: entry.workspaceId,
            role: "owner",
          },
          requestId: crypto.randomUUID(),
          workspaceId: entry.workspaceId,
        },
      ),
    );
    const firstLeaseBody = agentLeaseSchema.parse(await firstLease.json());
    const failed = await agent.fetch(
      withTrustedContext(
        new Request("https://agent.internal/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            leaseToken: firstLeaseBody.leaseToken,
            outcome: { status: "failed", error: "provider unavailable" },
          }),
        }),
        {
          principal: {
            kind: "agent",
            agentId: agentIdSchema.parse("chief"),
            pubkey: chiefPubkey,
            workspaceId: entry.workspaceId,
            role: "owner",
          },
          requestId: crypto.randomUUID(),
          workspaceId: entry.workspaceId,
        },
      ),
    );
    const repairedActive = await activeManagedWorkspace(relay, identity);
    const repairedLease = await agent.fetch(
      withTrustedContext(
        new Request("https://agent.internal/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workerId: "iphone-retry", leaseSeconds: 60 }),
        }),
        {
          principal: {
            kind: "agent",
            agentId: agentIdSchema.parse("chief"),
            pubkey: chiefPubkey,
            workspaceId: entry.workspaceId,
            role: "owner",
          },
          requestId: crypto.randomUUID(),
          workspaceId: entry.workspaceId,
        },
      ),
    );

    expect(active.status).toBe(200);
    expect(firstLeaseBody).toMatchObject({
      job: { kind: "workspace.onboarding", agentId: "chief" },
    });
    expect(failed.status).toBe(200);
    expect(repairedActive.status).toBe(200);
    expect(agentLeaseSchema.parse(await repairedLease.json())).toMatchObject({
      job: { kind: "workspace.onboarding", agentId: "chief" },
    });
  });

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
      role: "owner" as const,
    };
    for (const specialistId of [
      "brand",
      "prospector",
      "engineer",
      "setup",
    ] as const) {
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
      lastMessage: expect.stringContaining("@Setup"),
    });
    expect(messagePage.messages[0]).toMatchObject({
      author: { kind: "agent", id: "chief" },
      body: delegation.openingMessage,
    });
    expect(messagePage.messages).toHaveLength(6);
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
        website: string;
        imageURL: string | null;
        isActive: boolean;
        onboardingComplete: boolean;
      }>;
    };
    expect(list.workspaces).toHaveLength(2);
    expect(list.workspaces.find((w) => w.id === betaId)).toMatchObject({
      name: "Beta",
      website: "https://heychief.sh",
      imageURL: null,
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
  it("keeps active workspace selection independent for each signed-in device", async () => {
    const relay = env as unknown as Parameters<
      typeof createManagedWorkspace
    >[0];
    const userId = userIdSchema.parse("multi-device-owner");
    const phone = {
      kind: "user" as const,
      userId,
      pubkey: hexKey("multi-device-owner-phone"),
    };
    const desktop = {
      kind: "user" as const,
      userId,
      pubkey: hexKey("multi-device-owner-desktop"),
    };
    const make = (commandId: string, name: string) =>
      createManagedWorkspace(
        relay,
        phone,
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

    const alpha = workspaceSnapshotSchema.parse(
      await (
        await make("fca0ea44-e52b-48c6-9ad7-000000000011", "Alpha")
      ).json(),
    );
    const beta = workspaceSnapshotSchema.parse(
      await (await make("fca0ea44-e52b-48c6-9ad7-000000000012", "Beta")).json(),
    );
    const activeId = async (identity: typeof phone) =>
      workspaceSnapshotSchema.parse(
        await (await activeManagedWorkspace(relay, identity)).json(),
      ).id;
    const listedActiveId = async (identity: typeof phone) =>
      workspaceListResultSchema
        .parse(await (await listManagedWorkspaces(relay, identity)).json())
        .workspaces.find((item) => item.isActive)?.id;

    expect(await activeId(desktop)).toBe(beta.id);
    await switchManagedWorkspace(relay, phone, alpha.id);

    expect(await activeId(phone)).toBe(alpha.id);
    expect(await activeId(desktop)).toBe(beta.id);
    expect(await listedActiveId(phone)).toBe(alpha.id);
    expect(await listedActiveId(desktop)).toBe(beta.id);
  });
});
