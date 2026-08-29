import { AISDKError, APICallError } from "ai";
import { Effect } from "effect";
import { z } from "zod";

import type { AgentConfig, AgentPrincipal } from "@chief/relay-contracts";
import { agentJobSchema } from "@chief/relay-contracts";

import type { AgentJobQueue } from "./agent-job-queue";
import { attempt, sync } from "./effect";
import { withTrustedContext } from "./internal-context";
import { releaseInternalResponse } from "./internal-response";

type AgentJob = ReturnType<typeof agentJobSchema.parse>;

export interface TurnFailure {
  readonly message: string;
  readonly cause?: unknown;
  readonly code?: string;
  readonly status?: number;
}

export function internalFailureMessage(failure: TurnFailure) {
  return failure.cause instanceof Error
    ? failure.cause.message
    : failure.message;
}

const hostedLeaseSchema = z.object({
  job: agentJobSchema,
  leaseToken: z.string(),
});
const secretValueSchema = z.object({ value: z.string().optional() });
const providerQuotaFailure =
  /\b(?:available balance|credit balance|insufficient[_ -]?quota|quota exceeded|usage limit reached)\b/iu;

export function hostedClaimRequest() {
  return new Request("https://agent.internal/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workerId: "cloudflare-hosted-cell",
      leaseSeconds: 300,
    }),
  });
}

export function trustedAgentContext(principal: AgentPrincipal) {
  return {
    principal,
    requestId: crypto.randomUUID(),
    workspaceId: principal.workspaceId,
    conversationId: null,
  };
}

export function hostedCompactionRatio(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0.75;
}

export function agentRetryDelay(attempt: number) {
  return Math.min(15 * 60_000, 30_000 * 2 ** Math.min(attempt, 5));
}

export function hostedErrorMessage(error: string) {
  return `Chief could not complete this step: ${error.slice(0, 600)}. Chief will retry automatically.`;
}

export function hostedTerminalErrorMessage(error: string) {
  return `Chief could not complete this step: ${error.slice(0, 600)}`;
}

export function shouldRetryHostedTurnFailure(
  failure: TurnFailure,
  priorInterruptions = 0,
) {
  if (priorInterruptions >= 2) return false;
  if (providerQuotaFailure.test(internalFailureMessage(failure))) return false;
  if (APICallError.isInstance(failure.cause)) {
    return failure.cause.isRetryable;
  }
  if (AISDKError.isInstance(failure.cause)) return false;
  return (
    failure.status === undefined ||
    failure.status === 408 ||
    failure.status === 409 ||
    failure.status === 429 ||
    failure.status >= 500
  );
}

export function isHostedInferenceTimeoutFailure(failure: TurnFailure) {
  const cause = failure.cause;
  if (cause instanceof Error && cause.name === "TimeoutError") return true;
  return /\b(?:aborted due to timeout|inference timed out)\b/iu.test(
    internalFailureMessage(failure),
  );
}

export async function parseHostedLease(response: Response) {
  const document: unknown = await response.json();
  return hostedLeaseSchema.parse(document);
}

export function resolveInferenceApiKey(
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
  config: AgentConfig,
) {
  return Effect.gen(function* () {
    if (job.workspaceId !== principal.workspaceId) {
      return yield* sync("agent.inference.workspace_scope", () => {
        throw new Error(
          "The agent principal does not belong to the job's workspace.",
        );
      });
    }
    const secretRef = config.inference.secretRef;
    if (secretRef) {
      const target = new URL("https://workspace.internal/secrets");
      target.searchParams.set("name", secretRef);
      const response = yield* attempt("agent.secret.get", () =>
        env.WORKSPACES.get(env.WORKSPACES.idFromName(job.workspaceId)).fetch(
          withTrustedContext(
            new Request(target, {
              method: "GET",
              headers: { "x-chief-internal-operation": "secret-get" },
            }),
            {
              principal,
              requestId: crypto.randomUUID(),
              workspaceId: principal.workspaceId,
            },
          ),
        ),
      );
      if (response.ok) {
        const value = yield* attempt("agent.secret.decode", () =>
          response.json(),
        );
        const document = yield* sync("agent.secret.validate", () =>
          secretValueSchema.parse(value),
        );
        if (document.value) return document.value;
      } else if (response.status === 404) {
        yield* attempt("agent.secret.missing.release", () =>
          releaseInternalResponse(response),
        );
      } else {
        const detail = yield* attempt("agent.secret.error.decode", () =>
          response.text(),
        );
        return yield* sync("agent.secret.error", () => {
          throw new Error(
            `Inference credential lookup failed (${response.status})${
              detail ? `: ${detail.slice(0, 500)}` : "."
            }`,
          );
        });
      }
    }
    return yield* sync("agent.inference.credential", () => {
      throw new Error(
        "No inference credential is configured for this workspace's hosted agents.",
      );
    });
  });
}

export function completeAgentJob(
  queue: AgentJobQueue,
  leaseToken: string,
  principal: AgentPrincipal,
  outcome:
    | { status: "completed"; result: unknown }
    | { status: "failed"; error: string; retryAt?: string },
) {
  return Effect.gen(function* () {
    const response = yield* attempt("agent.job.complete", () =>
      queue.complete(
        new Request("https://agent.internal/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ leaseToken, outcome }),
        }),
        trustedAgentContext(principal),
      ),
    );
    const completed = response.ok;
    yield* attempt("agent.job.complete.release", () =>
      releaseInternalResponse(response),
    );
    yield* sync("agent.job.complete.verify", () => {
      if (!completed) {
        throw new Error(`Hosted cell completion failed (${response.status}).`);
      }
    });
  });
}
