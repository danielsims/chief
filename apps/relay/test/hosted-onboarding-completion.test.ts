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
import { performChiefDelegation } from "./managed-workspace-test-helpers";

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

// Reproduces the hosted (cloud) Chief onboarding path: the run is performed by
// the hosted cell, whose principal pubkey falls back to `"0".repeat(64)` when
// the job carries no agentPubkey. That principal then calls complete-onboarding,
// which checks the key against the registered chief key.
describe("hosted Chief onboarding completion", () => {
  it("allows the hosted identity to finalize onboarding even without a matching registered key", async () => {
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

    const chief: {
      kind: "agent";
      agentId: ReturnType<typeof agentIdSchema.parse>;
      pubkey: string;
      workspaceId: WorkspaceId;
      role: "owner" | "admin" | "member";
    } = {
      kind: "agent",
      agentId: agentIdSchema.parse("chief"),
      pubkey: hexKey("hosted-owner-chief"),
      workspaceId: snapshot.id,
      role: "owner",
    };
    const delegation = await performChiefDelegation({
      relay: r,
      workspace,
      workspaceId: snapshot.id,
      chief,
    });

    // The hosted cell (no agentPubkey) presents the "0"*64 fallback pubkey.
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
            "x-chief-internal-operation": "complete-onboarding",
          },
          body: JSON.stringify({
            openingMessage: delegation.openingMessage,
            publishedMessage: {
              conversationId: "mission-control",
              body: delegation.openingMessage,
              components: [],
            },
          }),
        }),
        {
          principal: hostedPrincipal,
          requestId: crypto.randomUUID(),
          workspaceId: snapshot.id,
          conversationId: "mission-control",
        },
      ),
    );

    // The hosted identity must be able to finalize onboarding (this is the path
    // a cloud workspace actually uses). The current key check rejects it.
    expect(response.status).toBe(200);
  });
});
