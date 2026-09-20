import { APICallError } from "ai";
import { Effect } from "effect";
import { expect, test, vi } from "vitest";

import { agentJobSchema, agentPrincipalSchema } from "@chief/relay-contracts";

import {
  HOSTED_JOB_MAX_ATTEMPTS,
  hostedAutomaticRetryAt,
  hostedProviderErrorMessage,
  isHostedInferenceTimeoutFailure,
  isPermanentHostedFailure,
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

test("surfaces empty provider error bodies with the HTTP status", () => {
  const cause = new APICallError({
    message: "",
    url: "https://opencode.ai/zen/go/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 403,
    responseBody: "",
  });

  expect(hostedProviderErrorMessage(cause)).toBe(
    "Inference request failed (HTTP 403): empty error body",
  );
  expect(
    shouldRetryHostedTurnFailure({
      message: "The relay request is invalid.",
      cause,
      code: "invalid_request",
      status: 400,
    }),
  ).toBe(false);
});

test("does not retry an OpenCode region gate", () => {
  expect(
    isPermanentHostedFailure(
      "The latest version of this model is only available hosted in China and requires explicit opt in.",
    ),
  ).toBe(true);
  expect(
    shouldRetryHostedTurnFailure({
      message:
        "The latest version of this model is only available hosted in China and requires explicit opt in.",
      status: 403,
    }),
  ).toBe(false);
});

test("does not retry a missing hosted inference credential", () => {
  expect(
    shouldRetryHostedTurnFailure({
      message:
        "No inference credential is configured for this workspace's hosted agents.",
    }),
  ).toBe(false);
  expect(
    isPermanentHostedFailure(
      "No inference credential is configured for this workspace's hosted agents.",
    ),
  ).toBe(true);
  expect(
    shouldRetryHostedTurnFailure({
      message: "The specialist kickoff is missing its relay targets.",
      status: 409,
    }),
  ).toBe(false);
});

test("stops automatic retries after a small number of claims", () => {
  expect(hostedAutomaticRetryAt(1, "Transient executor disconnect.")).toEqual(
    expect.any(String),
  );
  expect(
    hostedAutomaticRetryAt(
      HOSTED_JOB_MAX_ATTEMPTS,
      "Transient executor disconnect.",
    ),
  ).toBeUndefined();
  expect(
    hostedAutomaticRetryAt(
      1,
      "No inference credential is configured for this workspace's hosted agents.",
    ),
  ).toBeUndefined();
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
