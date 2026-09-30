import { and, asc, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { agentMemories } from "../../db/schema/agent-memories";

export function agentMemoriesFindRecall(
  storage: DurableObjectStorage,
  { agentId, scopeKey }: { agentId: string; scopeKey: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .all<{ memory_id: number; text: string }>(
        db
          .select({
            memory_id: agentMemories.memory_id,
            text: agentMemories.text,
          })
          .from(agentMemories)
          .where(
            and(
              eq(agentMemories.agent_id, agentId),
              eq(agentMemories.scope_key, scopeKey),
            ),
          )
          .orderBy(asc(agentMemories.memory_id)),
      )
      .map((row) => ({ id: row.memory_id, text: row.text })),
  );
}
