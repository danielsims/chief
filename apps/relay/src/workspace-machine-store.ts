import {
  machineCreateSchema,
  machineDeleteResultSchema,
  machineSchema,
  machinesResultSchema,
  machineUpdateSchema,
  parseJsonValue,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { HttpError, json, parseJson } from "./http";

interface MachineRow extends Record<string, SqlStorageValue> {
  machine_id: string;
  name: string;
  kind: "cloudflare" | "self-hosted";
  status: "pairing" | "online" | "offline";
  endpoint: string | null;
  capabilities_json: string;
  agent_ids_json: string;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export function initializeWorkspaceMachines(storage: DurableObjectStorage) {
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS machines (
      machine_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      endpoint TEXT,
      capabilities_json TEXT NOT NULL,
      agent_ids_json TEXT NOT NULL,
      last_seen_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS machines_updated_idx ON machines (updated_at DESC);
  `);
  const now = new Date().toISOString();
  storage.sql.exec(
    `INSERT OR IGNORE INTO machines (
      machine_id, name, kind, status, endpoint, capabilities_json,
      agent_ids_json, last_seen_at, created_at, updated_at
    ) VALUES (?, ?, 'cloudflare', 'online', NULL, ?, ?, ?, ?, ?)`,
    "00000000-0000-4000-8000-000000000001",
    "Cloudflare Computer",
    JSON.stringify(["browser", "screen"]),
    JSON.stringify(["brand", "prospector", "setup"]),
    now,
    now,
    now,
  );
}

export async function routeWorkspaceMachines(
  storage: DurableObjectStorage,
  request: Request,
  operation: string,
  workspaceId: string,
) {
  if (operation === "data-machines-list")
    return listMachines(storage, workspaceId);
  if (operation === "data-machine-create") {
    return createMachine(storage, request, workspaceId);
  }
  if (operation === "data-machine-update") {
    return updateMachine(storage, request, workspaceId);
  }
  if (operation === "data-machine-delete")
    return deleteMachine(storage, request);
  return null;
}

function listMachines(storage: DurableObjectStorage, workspaceId: string) {
  return json(
    machinesResultSchema.parse({
      machines: readMachines(storage, workspaceId),
    }),
  );
}

async function createMachine(
  storage: DurableObjectStorage,
  request: Request,
  workspaceId: string,
) {
  const input = machineCreateSchema.parse(await parseJson(request));
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  storage.sql.exec(
    `INSERT INTO machines (
      machine_id, name, kind, status, endpoint, capabilities_json,
      agent_ids_json, last_seen_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    id,
    input.name,
    input.kind,
    input.kind === "cloudflare" ? "online" : "pairing",
    input.endpoint ?? null,
    JSON.stringify(input.capabilities),
    "[]",
    now,
    now,
  );
  return json(requireMachine(storage, workspaceId, id), { status: 201 });
}

async function updateMachine(
  storage: DurableObjectStorage,
  request: Request,
  workspaceId: string,
) {
  const id = machineId(request);
  requireMachine(storage, workspaceId, id);
  const input = machineUpdateSchema.parse(await parseJson(request));
  const now = new Date().toISOString();
  storage.sql.exec(
    `UPDATE machines SET name = ?, capabilities_json = ?, agent_ids_json = ?,
      updated_at = ? WHERE machine_id = ?`,
    input.name,
    JSON.stringify(input.capabilities),
    JSON.stringify(input.agentIds),
    now,
    id,
  );
  return json(requireMachine(storage, workspaceId, id));
}

function deleteMachine(storage: DurableObjectStorage, request: Request) {
  const id = machineId(request);
  const result = storage.sql.exec(
    "DELETE FROM machines WHERE machine_id = ?",
    id,
  );
  if (result.rowsWritten === 0) {
    throw new HttpError(404, "machine_not_found", "Machine not found.");
  }
  return json(machineDeleteResultSchema.parse({ id, deleted: true }));
}

export function readMachines(
  storage: DurableObjectStorage,
  workspaceId: string,
) {
  const organizationId = workspaceIdSchema.parse(workspaceId);
  return [
    ...storage.sql.exec<MachineRow>(
      "SELECT * FROM machines ORDER BY updated_at DESC",
    ),
  ].map((row) =>
    machineSchema.parse({
      id: row.machine_id,
      workspaceId: organizationId,
      name: row.name,
      kind: row.kind,
      status: row.status,
      ...(row.endpoint ? { endpoint: row.endpoint } : undefined),
      capabilities: parseStoredJson(row.capabilities_json),
      agentIds: parseStoredJson(row.agent_ids_json),
      ...(row.last_seen_at ? { lastSeenAt: row.last_seen_at } : undefined),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  );
}

function parseStoredJson(value: string) {
  const document: unknown = JSON.parse(value);
  return parseJsonValue(document);
}

function requireMachine(
  storage: DurableObjectStorage,
  workspaceId: string,
  id: string,
) {
  const machine = readMachines(storage, workspaceId).find(
    (item) => item.id === id,
  );
  if (!machine)
    throw new HttpError(404, "machine_not_found", "Machine not found.");
  return machine;
}

function machineId(request: Request) {
  const id = request.headers.get("x-chief-machine-id")?.trim();
  if (!id)
    throw new HttpError(400, "machine_id_missing", "Machine id is required.");
  return id;
}
