import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import {
  ownedAgentChannels,
  ownedAgents,
  ownedAgentThreads,
} from "../../db/schema/owned-agents";

export type OwnedAgentRow = typeof ownedAgents.$inferSelect;
export type OwnedAgentChannelRow = typeof ownedAgentChannels.$inferSelect;

export function ownedAgentsInsert(
  storage: DurableObjectStorage,
  row: typeof ownedAgents.$inferInsert,
) {
  const db = relayDatabase(storage);
  executeDatabaseQuery(() => db.run(db.insert(ownedAgents).values(row)));
}

export function ownedAgentsFind(
  storage: DurableObjectStorage,
  agentId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(
    () =>
      db.all<OwnedAgentRow>(
        db
          .select()
          .from(ownedAgents)
          .where(eq(ownedAgents.agent_id, agentId))
          .limit(1),
      )[0],
  );
}

export function ownedAgentsFindByPubkey(
  storage: DurableObjectStorage,
  pubkey: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(
    () =>
      db.all<OwnedAgentRow>(
        db
          .select()
          .from(ownedAgents)
          .where(eq(ownedAgents.pubkey, pubkey))
          .limit(1),
      )[0],
  );
}

export function ownedAgentsFindActiveByOwnerName(
  storage: DurableObjectStorage,
  ownerUserId: string,
  name: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(
    () =>
      db.all<OwnedAgentRow>(
        db
          .select()
          .from(ownedAgents)
          .where(
            and(
              eq(ownedAgents.owner_user_id, ownerUserId),
              eq(ownedAgents.name, name),
              eq(ownedAgents.status, "active"),
            ),
          )
          .limit(1),
      )[0],
  );
}

export function ownedAgentsListActive(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<OwnedAgentRow>(
      db
        .select()
        .from(ownedAgents)
        .where(eq(ownedAgents.status, "active"))
        .orderBy(ownedAgents.created_at),
    ),
  );
}

export function ownedAgentsUpdate(
  storage: DurableObjectStorage,
  agentId: string,
  values: Partial<typeof ownedAgents.$inferInsert>,
) {
  const db = relayDatabase(storage);
  executeDatabaseQuery(() =>
    db.run(
      db
        .update(ownedAgents)
        .set(values)
        .where(eq(ownedAgents.agent_id, agentId)),
    ),
  );
}

export function ownedAgentChannelsInsert(
  storage: DurableObjectStorage,
  row: typeof ownedAgentChannels.$inferInsert,
) {
  const db = relayDatabase(storage);
  executeDatabaseQuery(() =>
    db.run(db.insert(ownedAgentChannels).values(row).onConflictDoNothing()),
  );
}

export function ownedAgentChannelsFind(
  storage: DurableObjectStorage,
  agentId: string,
  conversationId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(
    () =>
      db.all<OwnedAgentChannelRow>(
        db
          .select()
          .from(ownedAgentChannels)
          .where(
            and(
              eq(ownedAgentChannels.agent_id, agentId),
              eq(ownedAgentChannels.conversation_id, conversationId),
            ),
          )
          .limit(1),
      )[0],
  );
}

export function ownedAgentChannelsListForAgent(
  storage: DurableObjectStorage,
  agentId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<OwnedAgentChannelRow>(
      db
        .select()
        .from(ownedAgentChannels)
        .where(eq(ownedAgentChannels.agent_id, agentId))
        .orderBy(ownedAgentChannels.added_at),
    ),
  );
}

export function ownedAgentChannelsListForConversation(
  storage: DurableObjectStorage,
  conversationId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<OwnedAgentChannelRow>(
      db
        .select()
        .from(ownedAgentChannels)
        .where(eq(ownedAgentChannels.conversation_id, conversationId)),
    ),
  );
}

export function ownedAgentChannelsDelete(
  storage: DurableObjectStorage,
  agentId: string,
  conversationId: string,
) {
  const db = relayDatabase(storage);
  executeDatabaseQuery(() =>
    db.run(
      db
        .delete(ownedAgentChannels)
        .where(
          and(
            eq(ownedAgentChannels.agent_id, agentId),
            eq(ownedAgentChannels.conversation_id, conversationId),
          ),
        ),
    ),
  );
}

export function ownedAgentChannelsDeleteForConversation(
  storage: DurableObjectStorage,
  conversationId: string,
) {
  const db = relayDatabase(storage);
  executeDatabaseQuery(() =>
    db.run(
      db
        .delete(ownedAgentChannels)
        .where(eq(ownedAgentChannels.conversation_id, conversationId)),
    ),
  );
}

/** Everything an agent could still reach goes when it is revoked. */
export function ownedAgentAccessDelete(
  storage: DurableObjectStorage,
  agentId: string,
) {
  const db = relayDatabase(storage);
  executeDatabaseQuery(() => {
    db.run(
      db
        .delete(ownedAgentChannels)
        .where(eq(ownedAgentChannels.agent_id, agentId)),
    );
    db.run(
      db
        .delete(ownedAgentThreads)
        .where(eq(ownedAgentThreads.agent_id, agentId)),
    );
  });
}

export function ownedAgentThreadsInsert(
  storage: DurableObjectStorage,
  agentId: string,
  threadRootId: string,
) {
  const db = relayDatabase(storage);
  executeDatabaseQuery(() =>
    db.run(
      db
        .insert(ownedAgentThreads)
        .values({ agent_id: agentId, thread_root_id: threadRootId })
        .onConflictDoNothing(),
    ),
  );
}

export function ownedAgentThreadsHas(
  storage: DurableObjectStorage,
  agentId: string,
  threadRootId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(
    () =>
      db.all(
        db
          .select()
          .from(ownedAgentThreads)
          .where(
            and(
              eq(ownedAgentThreads.agent_id, agentId),
              eq(ownedAgentThreads.thread_root_id, threadRootId),
            ),
          )
          .limit(1),
      ).length > 0,
  );
}
