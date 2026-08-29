import { APICallError } from "ai";
import { Effect } from "effect";
import { expect, test, vi } from "vitest";

import { agentJobSchema, agentPrincipalSchema } from "@chief/relay-contracts";

import {
  isHostedInferenceTimeoutFailure,
  resolveInferenceApiKey,
  shouldRetryHostedTurnFailure,
} from "../src/agent-runtime-support";
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

test("does not retry a provider usage-limit rejection", () => {
  const cause = new APICallError({
    message: "Weekly usage limit reached. Resets in 2 days.",
    url: "https://opencode.ai/zen/go/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 400,
  });

  expect(
    shouldRetryHostedTurnFailure({
      message: "The relay request is invalid.",
      cause,
      code: "invalid_request",
      status: 400,
    }),
  ).toBe(false);

  const rateLimitedQuota = new APICallError({
    message: "Weekly usage limit reached. Resets in 2 days.",
    url: "https://opencode.ai/zen/go/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 429,
  });
  expect(
    shouldRetryHostedTurnFailure({
      message: rateLimitedQuota.message,
      cause: rateLimitedQuota,
      code: "invalid_request",
      status: 400,
    }),
  ).toBe(false);
});

test("continues to retry transient provider failures", () => {
  for (const statusCode of [429, 503]) {
    const cause = new APICallError({
      message: `Transient provider failure (${statusCode}).`,
      url: "https://opencode.ai/zen/go/v1/chat/completions",
      requestBodyValues: {},
      statusCode,
    });

    expect(
      shouldRetryHostedTurnFailure({
        message: cause.message,
        cause,
        code: "invalid_request",
        status: 400,
      }),
    ).toBe(true);
    expect(
      shouldRetryHostedTurnFailure(
        {
          message: cause.message,
          cause,
          code: "invalid_request",
          status: 400,
        },
        2,
      ),
    ).toBe(false);
  }
});

test("recognizes the hosted inference timeout reported by AI SDK", () => {
  const cause = Object.assign(
    new Error("The operation was aborted due to timeout"),
    { name: "TimeoutError" },
  );

  expect(
    isHostedInferenceTimeoutFailure({
      message: cause.message,
      cause,
      code: "invalid_request",
      status: 400,
    }),
  ).toBe(true);
  expect(
    isHostedInferenceTimeoutFailure({
      message: "The model rejected the prompt.",
      cause: new Error("The model rejected the prompt."),
      code: "invalid_request",
      status: 400,
    }),
  ).toBe(false);
});
