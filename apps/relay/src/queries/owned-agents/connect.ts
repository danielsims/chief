import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import {
  ownedAgentChallenges,
  ownedAgentConnectCodes,
  ownedAgentRequests,
} from "../../db/schema/owned-agents";

export type OwnedAgentConnectCodeRow =
  typeof ownedAgentConnectCodes.$inferSelect;
export type OwnedAgentRequestRow = typeof ownedAgentRequests.$inferSelect;

export function ownedAgentConnectCodesInsert(
  storage: DurableObjectStorage,
  row: typeof ownedAgentConnectCodes.$inferInsert,
) {
  const db = relayDatabase(storage);
  executeDatabaseQuery(() =>
    db.run(db.insert(ownedAgentConnectCodes).values(row)),
  );
}

export function ownedAgentConnectCodesFind(
  storage: DurableObjectStorage,
  codeHash: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(
    () =>
      db.all<OwnedAgentConnectCodeRow>(
        db
          .select()
          .from(ownedAgentConnectCodes)
          .where(eq(ownedAgentConnectCodes.code_hash, codeHash))
          .limit(1),
      )[0],
  );
}

export function ownedAgentConnectCodesCountActive(
  storage: DurableObjectStorage,
  userId: string,
  now: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(
    () =>
      db.all<OwnedAgentConnectCodeRow>(
        db
          .select()
          .from(ownedAgentConnectCodes)
          .where(
            and(
              eq(ownedAgentConnectCodes.user_id, userId),
              isNull(ownedAgentConnectCodes.invalidated_at),
              gt(ownedAgentConnectCodes.expires_at, now),
            ),
          ),
      ).length,
  );
}

export function ownedAgentConnectCodesCountRequest(
  storage: DurableObjectStorage,
  codeHash: string,
) {
  const db = relayDatabase(storage);
  executeDatabaseQuery(() =>
    db.run(
      db
        .update(ownedAgentConnectCodes)
        .set({
          request_count: sql`${ownedAgentConnectCodes.request_count} + ${1}`,
        })
        .where(eq(ownedAgentConnectCodes.code_hash, codeHash)),
    ),
  );
}

/** Ends every code this member still has open, and the requests behind them. */
export function ownedAgentConnectCodesInvalidateForUser(
  storage: DurableObjectStorage,
  userId: string,
  now: string,
) {
  const db = relayDatabase(storage);
  executeDatabaseQuery(() => {
    db.run(
      db
        .update(ownedAgentConnectCodes)
        .set({ invalidated_at: now })
        .where(
          and(
            eq(ownedAgentConnectCodes.user_id, userId),
            isNull(ownedAgentConnectCodes.invalidated_at),
          ),
        ),
    );
    db.run(
      db
        .update(ownedAgentRequests)
        .set({ status: "expired", decided_at: now })
        .where(
          and(
            eq(ownedAgentRequests.user_id, userId),
            eq(ownedAgentRequests.status, "pending"),
          ),
        ),
    );
  });
}

/** Drops codes, requests and challenges that can no longer be used. */
export function ownedAgentConnectPrune(
  storage: DurableObjectStorage,
  now: string,
  retainedSince: string,
) {
  const db = relayDatabase(storage);
  executeDatabaseQuery(() => {
    db.run(
      db
        .delete(ownedAgentConnectCodes)
        .where(lt(ownedAgentConnectCodes.expires_at, retainedSince)),
    );
    db.run(
      db
        .delete(ownedAgentRequests)
        .where(lt(ownedAgentRequests.expires_at, retainedSince)),
    );
    db.run(
      db
        .delete(ownedAgentChallenges)
        .where(lt(ownedAgentChallenges.expires_at, now)),
    );
  });
}

export function ownedAgentRequestsInsert(
  storage: DurableObjectStorage,
  row: typeof ownedAgentRequests.$inferInsert,
) {
  const db = relayDatabase(storage);
  executeDatabaseQuery(() => db.run(db.insert(ownedAgentRequests).values(row)));
}

export function ownedAgentRequestsFind(
  storage: DurableObjectStorage,
  requestId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(
    () =>
      db.all<OwnedAgentRequestRow>(
        db
          .select()
          .from(ownedAgentRequests)
          .where(eq(ownedAgentRequests.request_id, requestId))
          .limit(1),
      )[0],
  );
}

export function ownedAgentRequestsFindByDeviceCodeHash(
  storage: DurableObjectStorage,
  deviceCodeHash: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(
    () =>
      db.all<OwnedAgentRequestRow>(
        db
          .select()
          .from(ownedAgentRequests)
          .where(eq(ownedAgentRequests.device_code_hash, deviceCodeHash))
          .limit(1),
      )[0],
  );
}

export function ownedAgentRequestsListPending(
  storage: DurableObjectStorage,
  userId: string,
  now: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<OwnedAgentRequestRow>(
      db
        .select()
        .from(ownedAgentRequests)
        .where(
          and(
            eq(ownedAgentRequests.user_id, userId),
            eq(ownedAgentRequests.status, "pending"),
            gt(ownedAgentRequests.expires_at, now),
          ),
        )
        .orderBy(ownedAgentRequests.created_at),
    ),
  );
}

/** A key or a name can only wait in one open request at a time. */
export function ownedAgentRequestsFindOpenConflict(
  storage: DurableObjectStorage,
  input: { userId: string; name: string; pubkey: string; now: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(
    () =>
      db.all<OwnedAgentRequestRow>(
        db
          .select()
          .from(ownedAgentRequests)
          .where(
            and(
              eq(ownedAgentRequests.status, "pending"),
              gt(ownedAgentRequests.expires_at, input.now),
              or(
                eq(ownedAgentRequests.pubkey, input.pubkey),
                and(
                  eq(ownedAgentRequests.user_id, input.userId),
                  eq(ownedAgentRequests.name, input.name),
                ),
              ),
            ),
          )
          .limit(1),
      )[0],
  );
}

export function ownedAgentRequestsUpdate(
  storage: DurableObjectStorage,
  requestId: string,
  values: Partial<typeof ownedAgentRequests.$inferInsert>,
) {
  const db = relayDatabase(storage);
  executeDatabaseQuery(() =>
    db.run(
      db
        .update(ownedAgentRequests)
        .set(values)
        .where(eq(ownedAgentRequests.request_id, requestId)),
    ),
  );
}

export function ownedAgentChallengesInsert(
  storage: DurableObjectStorage,
  row: typeof ownedAgentChallenges.$inferInsert,
) {
  const db = relayDatabase(storage);
  executeDatabaseQuery(() =>
    db.run(db.insert(ownedAgentChallenges).values(row)),
  );
}

/** Spends a challenge. It is gone whether or not it was still valid. */
export function ownedAgentChallengesConsume(
  storage: DurableObjectStorage,
  challengeHash: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(
    () =>
      db.all<typeof ownedAgentChallenges.$inferSelect>(
        db
          .delete(ownedAgentChallenges)
          .where(eq(ownedAgentChallenges.challenge_hash, challengeHash))
          .returning(),
      )[0],
  );
}

export function ownedAgentChallengesDeleteForAgent(
  storage: DurableObjectStorage,
  agentId: string,
) {
  const db = relayDatabase(storage);
  executeDatabaseQuery(() =>
    db.run(
      db
        .delete(ownedAgentChallenges)
        .where(eq(ownedAgentChallenges.agent_id, agentId)),
    ),
  );
}
