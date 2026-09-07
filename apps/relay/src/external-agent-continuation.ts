import type {
  AgentId,
  AgentPrincipal,
  WorkspaceId,
} from "@chief/relay-contracts";
import { agentIdSchema } from "@chief/relay-contracts";

import type { WorkspaceChannelStore } from "./workspace-channel-store";
import { requireChannelToken, sha256 } from "./external-agent-channel-security";
import { HttpError } from "./http";
import { readTrustedContext } from "./internal-context";
import { firstRow } from "./workspace-channel-store";
import {
  readScheduleRun,
  scheduleRunIsActive,
} from "./workspace-schedule-runs";

export interface ExternalAgentInboundHost {
  storage: DurableObjectStorage;
  env: Env;
  channels: WorkspaceChannelStore;
  runtime: (agentId: string) => { token_hash: string } | undefined;
}

export const EXTERNAL_AGENT_PUBKEY = "0".repeat(64);

export interface ExternalContinuationRow extends Record<
  string,
  SqlStorageValue
> {
  conversation_id: string;
  thread_root_id: string | null;
  session_id: string;
  payload_json: string;
}

export function externalAgentPrincipal(
  workspaceId: WorkspaceId,
  agentId: AgentId,
): AgentPrincipal {
  return {
    kind: "agent",
    agentId,
    pubkey: EXTERNAL_AGENT_PUBKEY,
    workspaceId,
    role: "member",
  };
}

export async function resolveExternalContinuation(
  host: ExternalAgentInboundHost,
  request: Request,
  rawAgentId: string,
  input: { continuation: { capability: string }; sessionId: string },
  completionReceipt = false,
) {
  const context = readTrustedContext(request);
  const agentId = agentIdSchema.parse(rawAgentId);
  const runtime = host.runtime(agentId);
  if (!runtime) {
    throw new HttpError(
      404,
      "external_agent_not_found",
      "This external agent is not registered.",
    );
  }
  await requireChannelToken(request, runtime.token_hash);
  const continuation = firstRow<ExternalContinuationRow>(
    host.storage.sql.exec(
      `SELECT conversation_id, thread_root_id, session_id, payload_json FROM external_agent_outbox WHERE agent_id = ? AND capability_hash = ? AND status = 'accepted'`,
      agentId,
      await sha256(input.continuation.capability),
    ),
  );
  if (!continuation || continuation.session_id !== input.sessionId) {
    throw new HttpError(
      403,
      "external_continuation_invalid",
      "This continuation was not issued to this agent session.",
    );
  }
  if (continuation.thread_root_id) {
    const scheduled = host.storage.sql
      .exec<{ id: string }>(
        "SELECT id FROM workspace_schedule_runs WHERE json_extract(document_json, '$.threadRootId') = ? LIMIT 1",
        continuation.thread_root_id,
      )
      .toArray()[0];
    const run = scheduled
      ? readScheduleRun(host.storage, scheduled.id)?.run
      : undefined;
    if (
      run &&
      ((!scheduleRunIsActive(run) && !completionReceipt) ||
        (scheduleRunIsActive(run) &&
          run.startedAt !== undefined &&
          Date.now() >=
            run.startedAt + run.schedule.maxDurationMinutes * 60_000))
    )
      throw new HttpError(
        409,
        "schedule_run_stopped",
        "This scheduled run is no longer active.",
      );
  }
  return {
    context,
    agentId,
    principal: externalAgentPrincipal(context.workspaceId, agentId),
    continuation,
  };
}
