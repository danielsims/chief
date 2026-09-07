import { z } from "zod";

import type {
  AgentJob,
  AgentJobCompletionResult,
  JsonValue,
} from "@chief/relay-contracts";
import { isJsonString, parseJsonObject } from "@chief/relay-contracts";

import { firstAgentRow } from "./agent-job-store";
import { safeJsonArray } from "./agent-object-values";
import { cellRecordsFindLoadArray } from "./queries/cell-records/find-load-array";
import { cellRecordsInsertPutRecord } from "./queries/cell-records/insert-put-record";

const DURABLE_MEMORY_ENTRY_LIMIT = 8;
const DURABLE_MEMORY_CHARACTER_LIMIT = 6_000;
const workMemoryEntrySchema = z.object({
  user: z.string(),
  assistant: z.string(),
  conversationId: z.string().default("unknown"),
});

export function loadAgentWorkMemory(storage: DurableObjectStorage) {
  const entries = loadArray(storage, "agent:work-journal")
    .slice(-DURABLE_MEMORY_ENTRY_LIMIT)
    .flatMap((value) => {
      const parsed = workMemoryEntrySchema.safeParse(value);
      if (!parsed.success) return [];
      const { assistant, conversationId, user } = parsed.data;
      if (!user && !assistant) return [];
      return [
        `[${conversationId}] Request: ${user.slice(0, 300)}\nOutcome: ${assistant.slice(0, 500)}`,
      ];
    });
  return entries.join("\n\n").slice(-DURABLE_MEMORY_CHARACTER_LIMIT);
}

export function recordCompletedTurn(
  storage: DurableObjectStorage,
  job: AgentJob,
  result: AgentJobCompletionResult,
  agent?: { id: string; name: string; role: string },
) {
  const conversationId = isJsonString(job.payload.conversationId)
    ? job.payload.conversationId
    : "mission-control";
  const key = `conversation:${conversationId}:messages`;
  const priorMessages = loadArray(storage, key).filter(
    (value) => parseJsonObject(value)?.jobId !== job.id,
  );
  const at = Date.now();
  const instruction = isJsonString(job.payload.instruction)
    ? job.payload.instruction
    : job.kind;
  const answer =
    result.publishedMessage?.body ?? result.openingMessage ?? "Completed.";
  const messages = [
    ...priorMessages,
    { jobId: job.id, role: "user", content: instruction, at, conversationId },
    {
      jobId: job.id,
      role: "assistant",
      content: answer,
      at: at + 1,
      conversationId,
    },
  ];
  const now = new Date().toISOString();
  const journal = [
    ...loadArray(storage, "agent:work-journal").filter(
      (value) => parseJsonObject(value)?.jobId !== job.id,
    ),
    {
      jobId: job.id,
      conversationId,
      user: instruction.slice(0, 1_000),
      assistant: answer.slice(0, 2_000),
      completedAt: now,
    },
  ];
  storage.transactionSync(() => {
    putRecord(storage, key, messages.slice(-200), now);
    putRecord(storage, "agent:work-journal", journal.slice(-120), now);
    putRecord(
      storage,
      "eve:package:manifest",
      {
        protocolVersion: 1,
        runtime: "chief-cloudflare-cell",
        agentId: job.agentId,
        scope: `${job.workspaceId}:${job.agentId}`,
      },
      now,
    );
    if (agent) {
      putRecord(
        storage,
        "eve:package:instructions",
        `You are ${agent.name}, the workspace's ${agent.role} agent.`,
        now,
      );
    }
  });
}

function loadArray(storage: DurableObjectStorage, key: string) {
  const row = firstAgentRow<{ value_json: string }>(
    cellRecordsFindLoadArray(storage, key),
  );
  return row ? safeJsonArray(row.value_json) : [];
}

function putRecord(
  storage: DurableObjectStorage,
  key: string,
  value: JsonValue,
  updatedAt: string,
) {
  cellRecordsInsertPutRecord(storage, {
    key: key,
    valueJson: JSON.stringify(value),
    updatedAt: updatedAt,
  });
}
