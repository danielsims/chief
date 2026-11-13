import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { WorkspaceId } from "@chief/relay-contracts";
import {
  agentIdSchema,
  createWorkspaceCommandSchema,
  provisionWorkspaceCommandSchema,
  userIdSchema,
} from "@chief/relay-contracts";

import { withTrustedContext } from "../src/internal-context";
import { createManagedWorkspace } from "../src/workspace-authority";
import { hexKey } from "./helpers";

type Relay = Parameters<typeof createManagedWorkspace>[0];

function relay(): Relay {
  return {
    ...env,
    BETTER_AUTH_SECRET: "test-auth-secret",
    BOOTSTRAP_TOKEN_SHA256: "test-bootstrap-token",
    CLOUDFLARE_ACCOUNT_ID: "test-account",
    CLOUDFLARE_EMAIL_API_TOKEN: "test-email-token",
    EMAIL_FROM_ADDRESS: "test@example.test",
    EMAIL_FROM_NAME: "Chief Test",
    RELAY_SECRET_KEY: "test-relay-secret-master-key-0123456789abcdef",
    RELAY_ID: "relay_test",
  };
}

describe("hosted workspace setup authorization", () => {
  it("requires the owner to finish setup instead of the hosted Chief identity", async () => {
    const r = relay();
    const identity = {
      kind: "user" as const,
      userId: userIdSchema.parse("hosted-owner"),
      pubkey: hexKey("hosted-owner"),
    };
    const command = createWorkspaceCommandSchema.parse({
      commandId: "3384c105-6bf9-443f-b447-0898cfa40d55",
      name: "Hosted Chief",
      website: "https://heychief.sh",
      runtime: "cloud" as const,
      agentRuntime: "relay-cell",
      inferenceProvider: "openCodeGo",
      inferenceModel: "deepseek-v4-flash",
      selectedApps: [],
    });
    const created = await createManagedWorkspace(
      r,
      identity,
      provisionWorkspaceCommandSchema.parse({
        workspace: command,
        secrets: { opencode: "test-opencode-key" },
      }),
    );
    const snapshot = (await created.json()) as {
      id: WorkspaceId;
      name: string;
    };
    const workspace = r.WORKSPACES.get(r.WORKSPACES.idFromName(snapshot.id));

    const hostedPrincipal = {
      kind: "agent" as const,
      agentId: agentIdSchema.parse("chief"),
      pubkey: "0".repeat(64),
      workspaceId: snapshot.id,
      role: "member" as const,
    };
    const response = await workspace.fetch(
      withTrustedContext(
        new Request("https://workspace.internal", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-chief-internal-operation": "finish-setup",
          },
          body: "{}",
        }),
        {
          principal: hostedPrincipal,
          requestId: crypto.randomUUID(),
          workspaceId: snapshot.id,
        },
      ),
    );

    expect(response.status).toBe(403);
    const finished = await workspace.fetch(
      withTrustedContext(
        new Request("https://workspace.internal", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-chief-internal-operation": "finish-setup",
          },
          body: "{}",
        }),
        {
          principal: { ...identity, workspaceId: snapshot.id, role: "owner" },
          requestId: crypto.randomUUID(),
          workspaceId: snapshot.id,
        },
      ),
    );
    expect(finished.status, await finished.clone().text()).toBe(200);
    expect(await finished.json()).toMatchObject({
      setupComplete: true,
      onboardingComplete: true,
    });
  });
});
