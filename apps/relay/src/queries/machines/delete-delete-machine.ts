import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { machines } from "../../db/schema/machines";

export function machinesDeleteDeleteMachine(
  storage: DurableObjectStorage,
  machineId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(db.delete(machines).where(eq(machines.machine_id, machineId))),
  );
}
