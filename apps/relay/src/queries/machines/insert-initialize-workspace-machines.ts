import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { machines } from "../../db/schema/machines";

export function machinesInsertInitializeWorkspaceMachines(
  storage: DurableObjectStorage,
  {
    machineId,
    name,
    capabilitiesJson,
    agentIdsJson,
    lastSeenAt,
    createdAt,
    updatedAt,
  }: {
    machineId: string;
    name: string;
    capabilitiesJson: string;
    agentIdsJson: string;
    lastSeenAt: string | null;
    createdAt: string;
    updatedAt: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(machines)
        .values({
          machine_id: machineId,
          name: name,
          kind: "cloudflare",
          status: "online",
          endpoint: null,
          capabilities_json: capabilitiesJson,
          agent_ids_json: agentIdsJson,
          last_seen_at: lastSeenAt,
          created_at: createdAt,
          updated_at: updatedAt,
        })
        .onConflictDoNothing(),
    ),
  );
}
