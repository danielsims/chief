import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { agentIdSchema, workspaceIdSchema } from "@chief/relay-contracts";

import { withTrustedContext } from "../src/internal-context";

const workspaceId = workspaceIdSchema.parse("agent-queue-test");
const agentId = agentIdSchema.parse("engineer");

describe("AgentObject", () => {
  it("returns a failed job to the queue when a retry is scheduled", async () => {
    const stub = agentStub();
    const availableAt = new Date(Date.now() - 5_000).toISOString();
    const enqueue = await post(stub, "enqueue", {
      commandId: "b7720329-e143-435c-9ed7-e07ab1c7b3f5",
      protocolVersion: 1,
      occurredAt: availableAt,
      payload: {
        id: "5f1d373e-f255-461f-af8b-700d79966ad6",
        agentId,
        kind: "conversation.turn",
        payload: { conversationId: "engineering" },
        availableAt,
      },
    });
    const firstClaim = await post(stub, "claim", {
      workerId: "worker-a",
      leaseSeconds: 60,
    });
    const firstLease = (await firstClaim.json()) as { leaseToken: string };
    const failed = await post(stub, "complete", {
      leaseToken: firstLease.leaseToken,
      outcome: {
        status: "failed",
        error: "Transient executor disconnect.",
        retryAt: new Date(Date.now() - 1_000).toISOString(),
      },
    });
    const retryClaim = await post(stub, "claim", {
      workerId: "worker-b",
      leaseSeconds: 60,
    });

    expect(enqueue.status).toBe(200);
    expect(firstClaim.status).toBe(200);
    expect(await failed.json()).toMatchObject({
      job: { status: "pending", attempt: 1 },
    });
    expect(retryClaim.status).toBe(200);
    expect(await retryClaim.json()).toMatchObject({
      job: { status: "leased", attempt: 2 },
    });
  });
});

function agentStub() {
  const agents = (env as unknown as { AGENTS: DurableObjectNamespace }).AGENTS;
  return agents.get(agents.idFromName(`${workspaceId}:${agentId}`));
}

function post(stub: DurableObjectStub, operation: string, body: unknown) {
  const request = withTrustedContext(
    new Request(`https://relay.test/internal/${operation}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    {
      principal: { kind: "agent", agentId, workspaceId },
      requestId: crypto.randomUUID(),
      workspaceId,
    },
  );
  return stub.fetch(request);
}
