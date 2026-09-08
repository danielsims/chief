import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { pushDevices } from "../../db/schema/push-devices";

export function pushDevicesInsertRegisterPushDevice(
  storage: DurableObjectStorage,
  {
    token,
    environment,
    updatedAt,
  }: { token: string; environment: string; updatedAt: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(pushDevices)
        .values({
          token: token,
          environment: environment,
          updated_at: updatedAt,
        })
        .onConflictDoUpdate({
          target: [pushDevices.token],
          set: {
            environment: sql`excluded.environment`,
            updated_at: sql`excluded.updated_at`,
          },
        }),
    ),
  );
}
