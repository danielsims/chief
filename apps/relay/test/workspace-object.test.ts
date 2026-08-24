import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { userIdSchema, workspaceIdSchema } from "@chief/relay-contracts";

import { withTrustedIdentity } from "../src/internal-context";
import { hexKey } from "./helpers";

const workspaceId = workspaceIdSchema.parse("workspace-authority-test");
const ownerId = userIdSchema.parse("owner-user");
const outsiderId = userIdSchema.parse("outsider-user");

describe("WorkspaceObject", () => {
  it("claims a workspace once and derives current authority from membership", async () => {
    const stub = workspaceStub();
    const claim = await stub.fetch(
      trustedRequest("claim", ownerId, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: "82ac86dd-366c-4a58-9e91-6f47c4e95926",
          workspaceId,
          name: "Authority test",
          bootstrapToken: "chief-relay-bootstrap-token-for-tests",
        }),
      }),
    );
    const authorized = await stub.fetch(
      trustedRequest("authorize", ownerId, { method: "POST" }),
    );
    const outsider = await stub.fetch(
      trustedRequest("authorize", outsiderId, { method: "POST" }),
    );

    expect(claim.status).toBe(201);
    expect(await claim.json()).toMatchObject({
      workspaceId,
      principal: {
        kind: "user",
        userId: ownerId,
        pubkey: hexKey(ownerId),
        role: "owner",
      },
    });
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toMatchObject({
      principal: {
        kind: "user",
        userId: ownerId,
        pubkey: hexKey(ownerId),
        role: "owner",
      },
    });
    expect(outsider.status).toBe(403);
  });

  it("does not allow the deployment bootstrap token to claim twice", async () => {
    const response = await workspaceStub().fetch(
      trustedRequest("claim", ownerId, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: "403eb320-a9d9-48cc-98de-a028bf38f49e",
          workspaceId,
          name: "Changed name",
          bootstrapToken: "chief-relay-bootstrap-token-for-tests",
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "workspace_already_claimed" },
    });
  });

  it("stores idempotent workspace logs and pages them without crossing authority", async () => {
    const stub = workspaceStub();
    const logBatch = {
      logs: [
        {
          id: "log-1",
          correlationId: "onboarding-run-1",
          workspaceId,
          type: "error",
          operation: "workspace.onboarding",
          deployment: "iphone",
          agentId: "chief",
          message: "Workspace kickoff could not reach its agent cell.",
          metadata: { statusCode: 503, retryable: true },
          createdAt: "2026-08-17T06:00:00.000Z",
        },
      ],
    };
    const recordRequest = () =>
      trustedRequest("record-logs", ownerId, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(logBatch),
      });
    const first = await stub.fetch(recordRequest());
    const duplicate = await stub.fetch(recordRequest());
    const list = await stub.fetch(
      trustedRequest("list-logs", ownerId, { method: "POST" }),
    );
    const outsider = await stub.fetch(
      trustedRequest("list-logs", outsiderId, { method: "POST" }),
    );

    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    expect(await first.json()).toEqual({ accepted: 1 });
    expect(await list.json()).toMatchObject({
      logs: [
        {
          id: "log-1",
          workspaceId,
          type: "error",
          deployment: "iphone",
          metadata: { statusCode: 503, retryable: true },
        },
      ],
    });
    expect(outsider.status).toBe(403);
  });

  it("rejects logs that claim a different workspace", async () => {
    const response = await workspaceStub().fetch(
      trustedRequest("record-logs", ownerId, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          logs: [
            {
              id: "foreign-log",
              correlationId: "foreign-run",
              workspaceId: "another-workspace",
              type: "warn",
              operation: "workspace.onboarding",
              message: "This should not be accepted.",
              createdAt: "2026-08-17T06:00:00.000Z",
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "workspace_mismatch" },
    });
  });

  it("resolves a registered agent pubkey to an agent principal on authorize", async () => {
    const stub = workspaceStub();
    const agentPubkey = hexKey("engineer-key");
    const register = await stub.fetch(
      trustedRequest("register-agent-key", ownerId, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "engineer", pubkey: agentPubkey }),
      }),
    );
    expect(register.status).toBe(200);

    const idempotent = await stub.fetch(
      trustedRequest("register-agent-key", ownerId, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "engineer", pubkey: agentPubkey }),
      }),
    );
    const implicitRotation = await stub.fetch(
      trustedRequest("register-agent-key", ownerId, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: "engineer",
          pubkey: hexKey("replacement-engineer-key"),
        }),
      }),
    );
    const sharedKey = await stub.fetch(
      trustedRequest("register-agent-key", ownerId, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "chief", pubkey: agentPubkey }),
      }),
    );
    expect(idempotent.status).toBe(200);
    expect(implicitRotation.status).toBe(409);
    expect(await implicitRotation.json()).toMatchObject({
      error: { code: "agent_key_already_registered" },
    });
    expect(sharedKey.status).toBe(409);
    expect(await sharedKey.json()).toMatchObject({
      error: { code: "agent_key_reuse_denied" },
    });

    const listed = await stub.fetch(
      trustedRequest("agent-keys", ownerId, { method: "POST" }),
    );
    expect(await listed.json()).toMatchObject({
      agents: [{ agentId: "engineer", pubkey: agentPubkey }],
    });

    const authorized = await stub.fetch(
      trustedAgentRequest("engineer", agentPubkey),
    );
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toMatchObject({
      principal: {
        kind: "agent",
        agentId: "engineer",
        pubkey: agentPubkey,
        workspaceId,
      },
    });
  });
});

function workspaceStub() {
  const workspaces = (env as unknown as { WORKSPACES: DurableObjectNamespace })
    .WORKSPACES;
  return workspaces.get(workspaces.idFromName(workspaceId));
}

function trustedRequest(
  operation:
    | "authorize"
    | "claim"
    | "record-logs"
    | "list-logs"
    | "register-agent-key"
    | "agent-keys",
  userId: typeof ownerId,
  init: RequestInit,
  identityPubkey = hexKey(userId),
) {
  const headers = new Headers(init.headers);
  headers.set("x-chief-internal-operation", operation);
  return withTrustedIdentity(
    {
      identity: { kind: "user", userId, pubkey: identityPubkey },
      requestId: crypto.randomUUID(),
      workspaceId,
    },
    {
      ...init,
      headers,
    },
  );
}

function trustedAgentRequest(agentId: string, pubkey: string) {
  const headers = new Headers();
  headers.set("x-chief-internal-operation", "authorize");
  return withTrustedIdentity(
    {
      identity: {
        kind: "user",
        userId: userIdSchema.parse(agentId),
        pubkey,
      },
      requestId: crypto.randomUUID(),
      workspaceId,
    },
    { method: "POST", headers },
  );
}
