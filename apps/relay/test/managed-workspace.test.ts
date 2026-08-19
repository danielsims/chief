import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  agentLeaseSchema,
  createWorkspaceCommandSchema,
  messagePageSchema,
  userIdSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import { withTrustedContext } from "../src/internal-context";
import {
  activeManagedWorkspace,
  createManagedWorkspace,
} from "../src/workspace-authority";

describe("managed workspace onboarding", () => {
  it("creates an account workspace and durably queues Chief setup", async () => {
    const relay = env as unknown as Parameters<
      typeof createManagedWorkspace
    >[0];
    const identity = {
      kind: "user" as const,
      userId: userIdSchema.parse("managed-owner"),
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
      workspaceId: snapshot.id,
      role: "owner" as const,
    };
    const agent = relay.AGENTS.get(
      relay.AGENTS.idFromName(`${snapshot.id}:chief`),
    );
    const lease = await agent.fetch(
      withTrustedContext(
        new Request("https://agent.internal/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workerId: "iphone-test", leaseSeconds: 60 }),
        }),
        {
          principal,
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
              result: { openingMessage: "Chief is ready to get started." },
            },
          }),
        }),
        {
          principal,
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
      lastMessage: "Chief is ready to get started.",
    });
    expect(messagePage.messages[0]).toMatchObject({
      author: { kind: "agent", id: "chief" },
      body: "Chief is ready to get started.",
    });
  });
});
