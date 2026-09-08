import { describe, expect, it } from "vitest";

import type { JsonObject } from "@chief/relay-contracts";
import {
  agentIdSchema,
  agentJobListSchema,
  userIdSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { withTrustedContext } from "../src/internal-context";
import { hexKey, relayTestEnv } from "./helpers";

const workspaceId = workspaceIdSchema.parse("agent-queue-test");
const agentId = agentIdSchema.parse("engineer");
const agentPubkey = hexKey("engineer");

describe("AgentObject", () => {
  it("refreshes deterministic pending onboarding jobs with the current contract", async () => {
    const stub = agentStub();
    const availableAt = new Date(Date.now() - 5_000).toISOString();
    const commandId = "2cc4420d-f56b-40ca-bfee-106fc0e75adc";
    const jobId = "595a0571-cb5d-4718-9a55-36f21c9cfdbe";
    await post(stub, "enqueue", {
      commandId,
      protocolVersion: 1,
      occurredAt: availableAt,
      payload: {
        id: jobId,
        agentId,
        kind: "workspace.onboarding",
        payload: { workspaceName: "Chief 2" },
        availableAt,
      },
    });

    const ensured = await post(stub, "ensure", {
      commandId,
      protocolVersion: 1,
      occurredAt: new Date().toISOString(),
      payload: {
        id: jobId,
        agentId,
        kind: "workspace.onboarding",
        payload: {
          workspaceName: "Chief 2",
          instruction: "Use the canonical kickoff contract.",
        },
        availableAt,
      },
    });
    const claimed = await post(stub, "claim", {
      workerId: "desktop-cell",
      leaseSeconds: 60,
    });

    expect(await ensured.json()).toMatchObject({
      duplicate: true,
      refreshed: true,
      job: {
        id: jobId,
        payload: { instruction: "Use the canonical kickoff contract." },
      },
    });
    expect(await claimed.json()).toMatchObject({
      job: {
        id: jobId,
        payload: { instruction: "Use the canonical kickoff contract." },
      },
    });
  });

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

  it("fails a kickoff job when the result cannot be saved instead of leaving it leased", async () => {
    const stub = agentStub();
    const availableAt = new Date(Date.now() - 5_000).toISOString();
    const jobId = "8a0c1e24-6b7d-4f11-9c2a-3e5f7d9b1c40";
    await post(stub, "enqueue", {
      commandId: "a1b2c3d4-e5f6-4789-a012-3456789abcde",
      protocolVersion: 1,
      occurredAt: availableAt,
      payload: {
        id: jobId,
        agentId,
        kind: "workspace.kickoff.engineering",
        payload: { conversationId: "engineering" },
        availableAt,
      },
    });
    const claimed = await post(stub, "claim", {
      workerId: "worker-kickoff",
      leaseSeconds: 60,
    });
    const lease = (await claimed.json()) as { leaseToken: string };
    const completed = await post(stub, "complete", {
      leaseToken: lease.leaseToken,
      outcome: {
        status: "completed",
        result: {
          publishedMessage: {
            conversationId: "engineering",
            body: "On it. Continuing in #engineering.",
          },
        },
      },
    });
    const listed = await ownerRequest(stub, "jobs", "GET");
    const list = agentJobListSchema.parse(await listed.json());
    const next = await post(stub, "claim", {
      workerId: "worker-after-kickoff",
      leaseSeconds: 60,
    });
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({
      job: { id: jobId, status: "failed" },
    });
    expect(list.jobs.find((job) => job.id === jobId)).toMatchObject({
      status: "failed",
    });
    expect(next.status).toBe(204);
  });

  it("stops automatically retrying after a few failed claims", async () => {
    const stub = agentStub();
    const availableAt = new Date(Date.now() - 5_000).toISOString();
    const jobId = "3c1d0a77-2c8a-4f61-9a3e-6d1f8c2e9b10";
    await post(stub, "enqueue", {
      commandId: "d4e5f607-1829-4a3b-9c0d-1e2f3a4b5c6d",
      protocolVersion: 1,
      occurredAt: availableAt,
      payload: {
        id: jobId,
        agentId,
        kind: "workspace.kickoff.engineering",
        payload: { conversationId: "engineering" },
        availableAt,
      },
    });
    for (let round = 0; round < 3; round += 1) {
      const claimed = await post(stub, "claim", {
        workerId: `worker-${round}`,
        leaseSeconds: 60,
      });
      expect(claimed.status).toBe(200);
      const lease = (await claimed.json()) as { leaseToken: string };
      await post(stub, "complete", {
        leaseToken: lease.leaseToken,
        outcome: {
          status: "failed",
          error: "Transient executor disconnect.",
          retryAt: new Date(Date.now() - 1_000).toISOString(),
        },
      });
    }
    const exhausted = await post(stub, "claim", {
      workerId: "worker-exhausted",
      leaseSeconds: 60,
    });
    const listed = await ownerRequest(stub, "jobs", "GET");
    const list = agentJobListSchema.parse(await listed.json());
    expect(exhausted.status).toBe(204);
    expect(list.jobs.find((job) => job.id === jobId)).toMatchObject({
      status: "failed",
      attempt: 3,
    });
    const retried = await ownerRequest(stub, `jobs/${jobId}/retry`, "POST");
    const resumed = await post(stub, "claim", {
      workerId: "worker-resumed",
      leaseSeconds: 60,
    });
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({
      job: { status: "pending", attempt: 0 },
    });
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({
      job: { status: "leased", attempt: 1 },
    });
  });

  it("renews a live job lease without incrementing its attempt", async () => {
    const stub = agentStub();
    const availableAt = new Date(Date.now() - 5_000).toISOString();
    await post(stub, "enqueue", {
      commandId: "08f553fa-d59c-4daf-b7fe-c37681370a79",
      protocolVersion: 1,
      occurredAt: availableAt,
      payload: {
        id: "f9d55836-a5fc-4ac3-b049-420a11711d13",
        agentId,
        kind: "conversation.turn",
        payload: { conversationId: "engineering" },
        availableAt,
      },
    });
    const claimed = await post(stub, "claim", {
      workerId: "desktop-cell",
      leaseSeconds: 5,
    });
    const lease = (await claimed.json()) as {
      job: { attempt: number; leaseExpiresAt: string };
      leaseToken: string;
    };
    const renewed = await post(stub, "renew", {
      leaseToken: lease.leaseToken,
      leaseSeconds: 300,
    });
    const result = (await renewed.json()) as { leaseExpiresAt: string };

    expect(renewed.status).toBe(200);
    expect(lease.job.attempt).toBe(1);
    expect(Date.parse(result.leaseExpiresAt)).toBeGreaterThan(
      Date.parse(lease.job.leaseExpiresAt),
    );
  });

  it("lets an owner inspect and resume a terminal agent failure", async () => {
    const stub = agentStub();
    const availableAt = new Date(Date.now() - 5_000).toISOString();
    const jobId = "77923acf-9131-4359-910b-2f20bb84bd51";
    await post(stub, "enqueue", {
      commandId: "11d82880-2a20-477a-a5fd-6cba63cad77a",
      protocolVersion: 1,
      occurredAt: availableAt,
      payload: {
        id: jobId,
        agentId,
        kind: "workspace.kickoff.engineering",
        payload: { conversationId: "engineering" },
        availableAt,
      },
    });
    const claimed = await post(stub, "claim", {
      workerId: "iphone",
      leaseSeconds: 60,
    });
    const lease = (await claimed.json()) as { leaseToken: string };
    await post(stub, "complete", {
      leaseToken: lease.leaseToken,
      outcome: {
        status: "failed",
        error: "The selected inference model reached its usage limit.",
      },
    });

    const listed = await ownerRequest(stub, "jobs", "GET");
    const list = agentJobListSchema.parse(await listed.json());
    const failed = list.jobs.find((job) => job.id === jobId);
    const retried = await ownerRequest(stub, `jobs/${jobId}/retry`, "POST");

    expect(listed.status).toBe(200);
    expect(failed).toMatchObject({
      status: "failed",
      lastError: "The selected inference model reached its usage limit.",
      payload: { conversationId: "engineering" },
    });
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({
      job: { id: jobId, status: "pending", attempt: 0, lastError: null },
    });
  });

  it("round-trips logical state and computer files as one portable cell", async () => {
    const stub = agentStub();
    const first = await ownerRequest(
      stub,
      `snapshot?agentId=${agentId}`,
      "GET",
    );
    const initial = (await first.json()) as {
      cellId: string;
      records: unknown[];
    };
    const imported = await ownerRequest(
      stub,
      `snapshot?agentId=${agentId}`,
      "PUT",
      {
        version: 2,
        cellId: `${workspaceId}:${agentId}`,
        workspaceId,
        agentId,
        exportedAt: new Date().toISOString(),
        records: [
          {
            key: "conversation:general:messages",
            value: [{ role: "assistant", content: "Portable state" }],
          },
        ],
        files: [
          {
            path: "/workspace/README.md",
            contentBase64: btoa("# Portable agent\n"),
          },
        ],
      },
    );
    const exported = await ownerRequest(
      stub,
      `snapshot?agentId=${agentId}`,
      "GET",
    );

    expect(initial).toEqual({
      version: 2,
      cellId: `${workspaceId}:${agentId}`,
      workspaceId,
      agentId,
      exportedAt: expect.any(String),
      records: [],
      files: [],
    });
    expect(imported.status).toBe(200);
    expect(await imported.json()).toEqual({
      ok: true,
      importedRecords: 1,
      importedFiles: 1,
    });
    expect(await exported.json()).toMatchObject({
      version: 2,
      records: [
        {
          key: "conversation:general:messages",
          value: [{ role: "assistant", content: "Portable state" }],
        },
      ],
      files: [
        {
          path: "/workspace/README.md",
          contentBase64: btoa("# Portable agent\n"),
        },
      ],
    });
  });
});

function agentStub() {
  const { AGENTS: agents } = relayTestEnv();
  return agents.get(agents.idFromName(`${workspaceId}:${agentId}`));
}

function post(stub: DurableObjectStub, operation: string, body: JsonObject) {
  const request = withTrustedContext(
    new Request(`https://relay.test/internal/${operation}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    {
      principal: {
        kind: "agent",
        agentId,
        pubkey: agentPubkey,
        workspaceId,
        role: "member",
      },
      requestId: crypto.randomUUID(),
      workspaceId,
    },
  );
  return stub.fetch(request);
}

function ownerRequest(
  stub: DurableObjectStub,
  path: string,
  method: "GET" | "POST" | "PUT",
  body?: JsonObject,
) {
  return stub.fetch(
    withTrustedContext(
      new Request(`https://relay.test/internal/${path}`, {
        method,
        ...(body === undefined
          ? undefined
          : {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }),
      }),
      {
        principal: {
          kind: "user",
          userId: userIdSchema.parse("workspace-owner"),
          pubkey: hexKey("workspace-owner"),
          workspaceId,
          role: "owner",
        },
        requestId: crypto.randomUUID(),
        workspaceId,
      },
    ),
  );
}
