import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { agentMemories } from "../../db/schema/agent-memories";

export function agentMemoriesDeleteRemove(
  storage: DurableObjectStorage,
  {
    agentId,
    scopeKey,
    memoryId,
  }: { agentId: string; scopeKey: string; memoryId: number },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .delete(agentMemories)
        .where(
          and(
            eq(agentMemories.agent_id, agentId),
            eq(agentMemories.scope_key, scopeKey),
            eq(agentMemories.memory_id, memoryId),
          ),
        ),
    ),
  );
}
