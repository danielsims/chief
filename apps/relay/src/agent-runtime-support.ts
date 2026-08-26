import { Effect } from "effect";
import { z } from "zod";

import type { AgentConfig, AgentPrincipal } from "@chief/relay-contracts";
import { agentJobSchema } from "@chief/relay-contracts";

import type { AgentJobQueue } from "./agent-job-queue";
import { attempt, sync } from "./effect";
import { withTrustedContext } from "./internal-context";

type AgentJob = ReturnType<typeof agentJobSchema.parse>;

const hostedLeaseSchema = z.object({
  job: agentJobSchema,
  leaseToken: z.string(),
});
const secretValueSchema = z.object({ value: z.string().optional() });

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
    const candidates = [config.inference.secretRef, "opencode"].filter(
      (name): name is string => Boolean(name),
    );
    for (const name of candidates) {
      const target = new URL("https://workspace.internal/secrets");
      target.searchParams.set("name", name);
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
      }
    }
    if (env.OPENCODE_API_KEY) return env.OPENCODE_API_KEY;
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
    yield* sync("agent.job.complete.verify", () => {
      if (!response.ok) {
        throw new Error(`Hosted cell completion failed (${response.status}).`);
      }
    });
  });
}
