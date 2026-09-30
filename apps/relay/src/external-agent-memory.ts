import { z } from "zod";

import { agentIdSchema } from "@chief/relay-contracts";

import type { ExternalAgentInboundHost } from "./external-agent-continuation";
import { requireChannelToken } from "./external-agent-channel-security";
import { HttpError, json, parseJson } from "./http";
import { agentMemoriesDeleteRemove } from "./queries/agent-memories/delete-remove";
import { agentMemoriesFindRecall } from "./queries/agent-memories/find-recall";
import { agentMemoriesInsertSave } from "./queries/agent-memories/insert-save";

/** Keeps recalled memory small enough to sit in every turn's context. */
const MEMORY_CHARACTER_LIMIT = 16_000;

const scopeKeySchema = z.string().min(1).max(512);
const memoryRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("recall"), scopeKey: scopeKeySchema }),
  z.object({
    action: z.literal("save"),
    scopeKey: scopeKeySchema,
    text: z.string().trim().min(1).max(2_000),
  }),
  z.object({
    action: z.literal("remove"),
    scopeKey: scopeKeySchema,
    id: z.number().int().positive(),
  }),
]);

/**
 * An external agent's long-term memory. It belongs to the agent, so every
 * conversation and channel the agent works in recalls the same notes. The
 * channel token proves which agent is calling; Eve's locked scope key
 * partitions the notes within it.
 */
export async function receiveExternalAgentMemory(
  host: ExternalAgentInboundHost,
  request: Request,
  rawAgentId: string,
) {
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
  const input = memoryRequestSchema.parse(await parseJson(request));
  const scope = { agentId, scopeKey: input.scopeKey };

  if (input.action === "save") {
    const used = agentMemoriesFindRecall(host.storage, scope).reduce(
      (total, memory) => total + memory.text.length,
      0,
    );
    if (used + input.text.length > MEMORY_CHARACTER_LIMIT) {
      throw new HttpError(
        409,
        "agent_memory_full",
        "Memory is full. Remove notes that no longer matter before saving more.",
      );
    }
    agentMemoriesInsertSave(host.storage, {
      ...scope,
      text: input.text,
      createdAt: new Date().toISOString(),
    });
  } else if (input.action === "remove") {
    agentMemoriesDeleteRemove(host.storage, { ...scope, memoryId: input.id });
  }
  return json({ memories: agentMemoriesFindRecall(host.storage, scope) });
}
