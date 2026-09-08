import { Effect } from "effect";

import type { DurableTurnRunner } from "@chief/agent-runtime/durable-turn";
import type { AgentJob, AgentPrincipal } from "@chief/relay-contracts";

import type { AgentJobQueue } from "./agent-job-queue";
import type { TurnFailure } from "./agent-runtime-support";
import {
  completeAgentJob,
  hostedAutomaticRetryAt,
  internalFailureMessage,
} from "./agent-runtime-support";
import { attempt } from "./effect";

export const finalizeTimedOutAgentTurn = Effect.fn("finalizeTimedOutAgentTurn")(
  function* (input: {
    storage: DurableObjectStorage;
    turns: DurableTurnRunner;
    job: AgentJob;
    workspaceName: string;
    failure: TurnFailure;
  }) {
    const wakeAt = Date.now() + 50;
    yield* attempt("agent.turn.finalize", () =>
      input.turns.requestFinalization(
        "The model response timed out before the requested work could finish.",
      ),
    );
    yield* Effect.logWarning("Agent turn is finalizing after timeout", {
      workspaceId: input.job.workspaceId,
      workspaceName: input.workspaceName,
      agentId: input.job.agentId,
      jobId: input.job.id,
      cause: internalFailureMessage(input.failure),
    });
    yield* attempt("agent.alarm.set", () => input.storage.setAlarm(wakeAt));
  },
);

export const failAgentAdmission = Effect.fn("failAgentAdmission")(
  function* (input: {
    queue: AgentJobQueue;
    job: AgentJob;
    leaseToken: string;
    principal: AgentPrincipal;
    workspaceName: string;
    error: Error;
  }) {
    const retryAt = hostedAutomaticRetryAt(
      input.job.attempt,
      input.error.message,
    );
    yield* Effect.logError("Agent admission failed", {
      workspaceId: input.job.workspaceId,
      workspaceName: input.workspaceName,
      agentId: input.job.agentId,
      jobId: input.job.id,
      cause: input.error.message,
      retryAt,
    });
    const error = input.error.message.slice(0, 4_000);
    yield* completeAgentJob(
      input.queue,
      input.leaseToken,
      input.principal,
      retryAt
        ? { status: "failed", error, retryAt }
        : { status: "failed", error },
    );
  },
);
