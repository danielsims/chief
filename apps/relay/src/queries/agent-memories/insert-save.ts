import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { agentMemories } from "../../db/schema/agent-memories";

export function agentMemoriesInsertSave(
  storage: DurableObjectStorage,
  {
    agentId,
    scopeKey,
    text,
    createdAt,
  }: { agentId: string; scopeKey: string; text: string; createdAt: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(agentMemories).values({
        agent_id: agentId,
        scope_key: scopeKey,
        text,
        created_at: createdAt,
      }),
    ),
  );
}
