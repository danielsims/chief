import type { AgentId, AgentPrincipal, WorkspaceId } from "@chief/relay-contracts";
import { agentIdSchema } from "@chief/relay-contracts";

import {
  requireChannelToken,
  sha256,
} from "./external-agent-channel-security";
import { HttpError } from "./http";
import { readTrustedContext } from "./internal-context";
import type { WorkspaceChannelStore } from "./workspace-channel-store";
import { firstRow } from "./workspace-channel-store";

export interface ExternalAgentInboundHost {
  storage: DurableObjectStorage;
  env: Env;
  channels: WorkspaceChannelStore;
  runtime: (agentId: string) => { token_hash: string } | undefined;
}

export const EXTERNAL_AGENT_PUBKEY = "0".repeat(64);

export interface ExternalContinuationRow extends Record<string, SqlStorageValue> {
  conversation_id: string;
  thread_root_id: string | null;
  session_id: string;
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
      `SELECT conversation_id, thread_root_id, session_id FROM external_agent_outbox WHERE agent_id = ? AND capability_hash = ? AND status = 'accepted'`,
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
  return {
    context,
    agentId,
    principal: externalAgentPrincipal(context.workspaceId, agentId),
    continuation,
  };
}
