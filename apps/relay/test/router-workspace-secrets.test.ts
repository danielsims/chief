import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { userIdSchema, workspaceIdSchema } from "@chief/relay-contracts";

import { readTrustedContext } from "../src/internal-context";
import * as RouterAuth from "../src/router-auth";
import { routeWorkspaceSecrets } from "../src/router-workspace-secrets";
import * as WorkspaceAuthority from "../src/workspace-authority";
import { hexKey, relayTestEnv } from "./helpers";

const workspaceId = workspaceIdSchema.parse("workspace-secret-route-test");
const userId = userIdSchema.parse("workspace-secret-owner");
const identity = { kind: "user" as const, userId, pubkey: hexKey(userId) };
const principal = {
  ...identity,
  workspaceId,
  role: "owner" as const,
};

describe("routeWorkspaceSecrets", () => {
  it("forwards the secret operation with trusted workspace context", async () => {
    vi.spyOn(RouterAuth, "authenticateRelayRequest").mockImplementation(
      async (request) => ({ identity, request, bound: true }),
    );
    vi.spyOn(WorkspaceAuthority, "authorizeWorkspace").mockResolvedValue(
      principal,
    );
    const fetch = vi.fn(async (request: Request) => {
      expect(request.headers.get("x-chief-internal-operation")).toBe(
        "secret-set",
      );
      expect(readTrustedContext(request)).toMatchObject({
        principal,
        requestId: "secret-request",
        workspaceId,
      });
      expect(await request.json()).toEqual({
        name: "opencode",
        value: "test-key",
      });
      return Response.json({ workspaceId, name: "opencode" });
    });
    const env: Env = Object.assign(relayTestEnv(), {
      WORKSPACES: {
        idFromName: vi.fn(() => ({ id: workspaceId })),
        get: vi.fn(() => ({ fetch })),
      },
    });

    const response = await Effect.runPromise(
      routeWorkspaceSecrets(
        env,
        new Request(`https://relay.test/v1/workspaces/${workspaceId}/secrets`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "opencode", value: "test-key" }),
        }),
        "secret-request",
        workspaceId,
      ),
    );

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
