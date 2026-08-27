import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  createWorkspaceCommandSchema,
  userIdSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import { AuthorizationError } from "../src/auth";
import { withTrustedIdentity } from "../src/internal-context";
import {
  authorizeWorkspace,
  createManagedWorkspace,
  switchManagedWorkspace,
} from "../src/workspace-authority";
import { hexKey } from "./helpers";

describe("workspace authorization", () => {
  it("resolves a registered agent key before applying human organization tenancy", async () => {
    const relay = chiefAccountEnv();
    const ownerId = userIdSchema.parse(`owner-${crypto.randomUUID()}`);
    const owner = {
      kind: "user" as const,
      userId: ownerId,
      pubkey: hexKey(ownerId),
    };
    await insertUser(relay.AUTH_DB, ownerId);
    const created = await createManagedWorkspace(
      relay,
      owner,
      createWorkspaceCommandSchema.parse({
        commandId: crypto.randomUUID(),
        name: "Agent authorization",
        website: "https://heychief.sh",
        runtime: "phone",
        inferenceProvider: "openCodeGo",
        inferenceModel: "deepseek-v4-flash",
        selectedApps: [],
      }),
    );
    const snapshot = workspaceSnapshotSchema.parse(await created.json());
    const chiefPubkey = hexKey(`chief-${snapshot.id}`);
    const workspace = relay.WORKSPACES.get(
      relay.WORKSPACES.idFromName(snapshot.id),
    );
    const registration = await workspace.fetch(
      withTrustedIdentity(
        {
          identity: owner,
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
    expect(registration.status).toBe(200);

    const principal = await authorizeWorkspace(relay, {
      // NIP-98 keys are user-shaped until the workspace resolves a registered
      // agent key to its first-class agent principal.
      identity: {
        kind: "user",
        userId: userIdSchema.parse(chiefPubkey),
        pubkey: chiefPubkey,
      },
      requestId: crypto.randomUUID(),
      workspaceId: snapshot.id,
    });

    expect(principal).toMatchObject({
      kind: "agent",
      agentId: "chief",
      pubkey: chiefPubkey,
      workspaceId: snapshot.id,
      role: "member",
    });
  });

  it("keeps request authorization in the workspace object without repeating D1 membership reads", async () => {
    const relay = chiefAccountEnv();
    const ownerId = userIdSchema.parse(`owner-${crypto.randomUUID()}`);
    const owner = {
      kind: "user" as const,
      userId: ownerId,
      pubkey: hexKey(ownerId),
    };
    await insertUser(relay.AUTH_DB, ownerId);
    const created = await createManagedWorkspace(
      relay,
      owner,
      createWorkspaceCommandSchema.parse({
        commandId: crypto.randomUUID(),
        name: "Human authorization",
        website: "https://heychief.sh",
        runtime: "phone",
        inferenceProvider: "openCodeGo",
        inferenceModel: "deepseek-v4-flash",
        selectedApps: [],
      }),
    );
    const snapshot = workspaceSnapshotSchema.parse(await created.json());
    await relay.AUTH_DB.prepare(
      "DELETE FROM member WHERE organization_id = ? AND user_id = ?",
    )
      .bind(snapshot.id, ownerId)
      .run();

    await expect(
      authorizeWorkspace(relay, {
        identity: owner,
        requestId: crypto.randomUUID(),
        workspaceId: snapshot.id,
      }),
    ).resolves.toMatchObject({
      kind: "user",
      userId: ownerId,
      workspaceId: snapshot.id,
    });

    await expect(
      switchManagedWorkspace(relay, owner, snapshot.id),
    ).rejects.toThrow(AuthorizationError);
  });

  it("does not admit an unregistered key", async () => {
    const relay = chiefAccountEnv();
    const ownerId = userIdSchema.parse(`owner-${crypto.randomUUID()}`);
    const owner = {
      kind: "user" as const,
      userId: ownerId,
      pubkey: hexKey(ownerId),
    };
    await insertUser(relay.AUTH_DB, ownerId);
    const created = await createManagedWorkspace(
      relay,
      owner,
      createWorkspaceCommandSchema.parse({
        commandId: crypto.randomUUID(),
        name: "Outsider authorization",
        website: "https://heychief.sh",
        runtime: "phone",
        inferenceProvider: "openCodeGo",
        inferenceModel: "deepseek-v4-flash",
        selectedApps: [],
      }),
    );
    const snapshot = workspaceSnapshotSchema.parse(await created.json());
    const outsiderPubkey = hexKey(`outsider-${snapshot.id}`);

    await expect(
      authorizeWorkspace(relay, {
        identity: {
          kind: "user",
          userId: userIdSchema.parse(outsiderPubkey),
          pubkey: outsiderPubkey,
        },
        requestId: crypto.randomUUID(),
        workspaceId: snapshot.id,
      }),
    ).rejects.toThrow(AuthorizationError);
  });
});

function chiefAccountEnv(): Env {
  return {
    ...env,
    ACCOUNT_IDENTITY_MODE: "chief-account",
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

function insertUser(database: D1Database, id: string) {
  const now = Date.now();
  return database
    .prepare(
      `INSERT INTO user (
        id, name, email, email_verified, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, id, `${id}@example.test`, now, now)
    .run();
}
