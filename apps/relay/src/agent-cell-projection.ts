import type {
  AgentJob,
  AgentJobCompletionResult,
  JsonValue,
} from "@chief/relay-contracts";
import { isJsonString, parseJsonObject } from "@chief/relay-contracts";

import { firstAgentRow } from "./agent-job-store";
import { safeJsonArray } from "./agent-object-values";

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
    storage.sql.exec("SELECT value_json FROM cell_records WHERE key = ?", key),
  );
  return row ? safeJsonArray(row.value_json) : [];
}

function putRecord(
  storage: DurableObjectStorage,
  key: string,
  value: JsonValue,
  updatedAt: string,
) {
  storage.sql.exec(
    `INSERT INTO cell_records (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
       updated_at = excluded.updated_at`,
    key,
    JSON.stringify(value),
    updatedAt,
  );
}
