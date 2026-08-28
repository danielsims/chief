import { Effect } from "effect";
import { expect, test, vi } from "vitest";

import { agentJobSchema, agentPrincipalSchema } from "@chief/relay-contracts";

import { resolveInferenceApiKey } from "../src/agent-runtime-support";
import { defaultAgentConfigFor } from "../src/workspace-agent-config";
import { relayTestEnv } from "./helpers";

function testEnvironment(fetch: ReturnType<typeof vi.fn>) {
  const get = vi.fn().mockReturnValue({ fetch });
  const environment: Env = Object.assign(relayTestEnv(), {
    OPENCODE_API_KEY: "must-not-be-used",
    WORKSPACES: {
      get,
      idFromName: vi.fn().mockReturnValue("workspace-object"),
    },
  });
  return { environment, get };
}

test("uses only the owning workspace inference credential", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(Response.json({ value: "workspace-key" }));
  const { environment, get } = testEnvironment(fetch);
  const now = new Date().toISOString();
  const job = agentJobSchema.parse({
    id: crypto.randomUUID(),
    workspaceId: "workspace-a",
    agentId: "chief",
    kind: "conversation.message",
    payload: {},
    status: "leased",
    attempt: 1,
    lastError: null,
    availableAt: now,
    leaseExpiresAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const principal = agentPrincipalSchema.parse({
    kind: "agent",
    agentId: "chief",
    pubkey: "0".repeat(64),
    workspaceId: "workspace-a",
    role: "owner",
  });

  const value = await Effect.runPromise(
    resolveInferenceApiKey(
      environment,
      job,
      principal,
      defaultAgentConfigFor("chief"),
    ),
  );

  expect(value).toBe("workspace-key");
  expect(get).toHaveBeenCalledWith("workspace-object");
  expect(fetch).toHaveBeenCalledOnce();
});

test("does not fall back to a relay-wide inference credential", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({}, { status: 404 }));
  const { environment } = testEnvironment(fetch);
  const now = new Date().toISOString();
  const job = agentJobSchema.parse({
    id: crypto.randomUUID(),
    workspaceId: "workspace-a",
    agentId: "chief",
    kind: "conversation.message",
    payload: {},
    status: "leased",
    attempt: 1,
    lastError: null,
    availableAt: now,
    leaseExpiresAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const principal = agentPrincipalSchema.parse({
    kind: "agent",
    agentId: "chief",
    pubkey: "0".repeat(64),
    workspaceId: "workspace-a",
    role: "owner",
  });

  await expect(
    Effect.runPromise(
      resolveInferenceApiKey(
        environment,
        job,
        principal,
        defaultAgentConfigFor("chief"),
      ),
    ),
  ).rejects.toThrow();
  expect(fetch).toHaveBeenCalledOnce();
});

test("rejects a principal from another workspace before reading a secret", async () => {
  const fetch = vi.fn();
  const { environment } = testEnvironment(fetch);
  const now = new Date().toISOString();
  const job = agentJobSchema.parse({
    id: crypto.randomUUID(),
    workspaceId: "workspace-a",
    agentId: "chief",
    kind: "conversation.message",
    payload: {},
    status: "leased",
    attempt: 1,
    lastError: null,
    availableAt: now,
    leaseExpiresAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const principal = agentPrincipalSchema.parse({
    kind: "agent",
    agentId: "chief",
    pubkey: "0".repeat(64),
    workspaceId: "workspace-b",
    role: "owner",
  });

  await expect(
    Effect.runPromise(
      resolveInferenceApiKey(
        environment,
        job,
        principal,
        defaultAgentConfigFor("chief"),
      ),
    ),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
