import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { machines } from "../../db/schema/machines";

export function machinesInsertCreateMachine(
  storage: DurableObjectStorage,
  {
    machineId,
    name,
    kind,
    status,
    endpoint,
    capabilitiesJson,
    agentIdsJson,
    createdAt,
    updatedAt,
  }: {
    machineId: string;
    name: string;
    kind: string;
    status: string;
    endpoint: string | null;
    capabilitiesJson: string;
    agentIdsJson: string;
    createdAt: string;
    updatedAt: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(machines).values({
        machine_id: machineId,
        name: name,
        kind: kind,
        status: status,
        endpoint: endpoint,
        capabilities_json: capabilitiesJson,
        agent_ids_json: agentIdsJson,
        last_seen_at: null,
        created_at: createdAt,
        updated_at: updatedAt,
      }),
    ),
  );
}
