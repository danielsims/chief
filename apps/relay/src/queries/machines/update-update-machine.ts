import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { machines } from "../../db/schema/machines";

export function machinesUpdateUpdateMachine(
  storage: DurableObjectStorage,
  {
    name,
    capabilitiesJson,
    agentIdsJson,
    updatedAt,
    machineId,
  }: {
    name: string;
    capabilitiesJson: string;
    agentIdsJson: string;
    updatedAt: string;
    machineId: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(machines)
        .set({
          name: name,
          capabilities_json: capabilitiesJson,
          agent_ids_json: agentIdsJson,
          updated_at: updatedAt,
        })
        .where(eq(machines.machine_id, machineId)),
    ),
  );
}
