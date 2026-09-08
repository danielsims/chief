import { afterEach, describe, expect, it, vi } from "vitest";

import { userIdSchema, workspaceIdSchema } from "@chief/relay-contracts";

import {
  withTrustedContext,
  withTrustedIdentity,
} from "../src/internal-context";
import { hexKey, relayTestEnv } from "./helpers";

const workspaceId = workspaceIdSchema.parse("workspace-vercel-test");
const ownerId = userIdSchema.parse("vercel-owner");
const memberId = userIdSchema.parse("vercel-member");
const token = "vercel-test-token-that-must-never-leak";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workspace Vercel connection", () => {
  it("validates and stores an owner token without returning it", async () => {
    const stub = workspaceStub();
    expect((await claimWorkspace(stub)).status).toBe(201);

    const vercelFetch = vi.fn(
      async (request: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(request);
        expect(requestHeaders(request, init).get("authorization")).toBe(
          `Bearer ${token}`,
        );
        if (url.pathname === "/v1/api-keys") {
          expect(url.searchParams.get("teamId")).toBe("team-1");
          return Response.json({ apiKeyString: "test-gateway-key" });
        }
        expect(url.pathname).toBe("/v2/teams");
        return Response.json({
          teams: [{ id: "team-1", name: "Workspace", slug: "workspace-owner" }],
        });
      },
    );
    vi.stubGlobal("fetch", vercelFetch);

    const connected = await stub.fetch(
      trustedOwnerRequest("vercel-connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }),
    );
    const payload = await connected.json();

    expect(connected.status).toBe(200);
    expect(payload).toEqual({
      teams: [{ id: "team-1", name: "Workspace", slug: "workspace-owner" }],
      projects: [],
    });
    expect(JSON.stringify(payload)).not.toContain(token);
    expect(JSON.stringify(payload)).not.toContain("test-gateway-key");
    expect(vercelFetch).toHaveBeenCalledTimes(2);
  });

  it("returns an actionable error when Vercel rejects a token", async () => {
    const stub = workspaceStub();
    await claimWorkspace(stub);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { message: "The token is invalid." } },
          { status: 403 },
        ),
      ),
    );

    const response = await stub.fetch(
      trustedOwnerRequest("vercel-connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: "vercel_connection_failed",
        message:
          "Vercel rejected this access token. Create a new token and try again.",
      },
    });
  });

  it("uses the relay-held token for later project discovery", async () => {
    const vercelFetch = vi.fn(
      async (request: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(request);
        expect(requestHeaders(request, init).get("authorization")).toBe(
          `Bearer ${token}`,
        );
        if (url.pathname === "/v2/teams") {
          return Response.json({
            teams: [
              { id: "team-1", name: "Workspace", slug: "workspace-owner" },
            ],
          });
        }
        expect(url.pathname).toBe("/v9/projects");
        expect(url.searchParams.get("teamId")).toBe("team-1");
        return Response.json({
          projects: [{ id: "project-1", name: "researcher", framework: null }],
        });
      },
    );
    vi.stubGlobal("fetch", vercelFetch);

    const response = await workspaceStub().fetch(
      trustedOwnerRequest("vercel-destinations", {
        method: "GET",
        url: "https://workspace.internal?teamId=team-1",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      teams: [{ id: "team-1", name: "Workspace", slug: "workspace-owner" }],
      selectedTeamId: "team-1",
      projects: [{ id: "project-1", name: "researcher" }],
    });
  });

  it("rejects connection management by a non-owner", async () => {
    const response = await workspaceStub().fetch(
      trustedMemberRequest("vercel-connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "should-not-be-accepted" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "vercel_owner_required" },
    });
  });

  it("rejects a deployment for a different workspace before calling Vercel", async () => {
    const vercelFetch = vi.fn();
    vi.stubGlobal("fetch", vercelFetch);
    const response = await workspaceStub().fetch(
      trustedOwnerRequest("vercel-provision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          teamId: "team-1",
          project: { kind: "new", projectName: "researcher" },
          agent: {
            name: "Researcher",
            description: "Researches markets.",
            instructions: "Return source-backed findings.",
            model: "openai/gpt-5.6-terra",
          },
          environment: {
            CHIEF_AGENT_ID: "researcher",
            CHIEF_CHANNEL_TOKEN: "channel-token",
            CHIEF_DELIVERY_SIGNING_KEY_ID: "signing-key",
            CHIEF_DELIVERY_SIGNING_SECRET: "signing-secret",
            CHIEF_RELAY_URL: "https://relay.test",
            CHIEF_WORKSPACE_ID: "workspace-someone-else",
          },
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "vercel_workspace_mismatch" },
    });
    expect(vercelFetch).not.toHaveBeenCalled();
  });
});

function workspaceStub() {
  const { WORKSPACES: workspaces } = relayTestEnv();
  return workspaces.get(workspaces.idFromName(workspaceId));
}

function claimWorkspace(stub: DurableObjectStub) {
  const headers = new Headers({ "content-type": "application/json" });
  headers.set("x-chief-internal-operation", "claim");
  return stub.fetch(
    withTrustedIdentity(
      {
        identity: { kind: "user", userId: ownerId, pubkey: hexKey(ownerId) },
        requestId: crypto.randomUUID(),
        workspaceId,
      },
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          commandId: "dd91d03e-fcad-43d7-aa8f-f751fb6c45e3",
          workspaceId,
          name: "Vercel connector test",
          bootstrapToken: "relay-bootstrap-token-for-testing",
        }),
      },
    ),
  );
}

function trustedOwnerRequest(
  operation: "vercel-connect" | "vercel-destinations" | "vercel-provision",
  init: RequestInit & { url?: string },
) {
  return trustedPrincipalRequest(operation, ownerId, "owner", init);
}

function trustedMemberRequest(
  operation: "vercel-connect",
  init: RequestInit & { url?: string },
) {
  return trustedPrincipalRequest(operation, memberId, "member", init);
}

function trustedPrincipalRequest(
  operation: "vercel-connect" | "vercel-destinations" | "vercel-provision",
  userId: typeof ownerId,
  role: "owner" | "member",
  init: RequestInit & { url?: string },
) {
  const headers = new Headers(init.headers);
  headers.set("x-chief-internal-operation", operation);
  const { url = "https://workspace.internal", ...requestInit } = init;
  return withTrustedContext(new Request(url, { ...requestInit, headers }), {
    principal: {
      kind: "user",
      userId,
      pubkey: hexKey(userId),
      workspaceId,
      role,
    },
    requestId: crypto.randomUUID(),
    workspaceId,
  });
}

function requestUrl(request: RequestInfo | URL) {
  return new URL(request instanceof Request ? request.url : request.toString());
}

function requestHeaders(request: RequestInfo | URL, init?: RequestInit) {
  return request instanceof Request
    ? request.headers
    : new Headers(init?.headers);
}
