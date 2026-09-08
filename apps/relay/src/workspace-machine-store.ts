import {
  machineCreateSchema,
  machineDeleteResultSchema,
  machineSchema,
  machinesResultSchema,
  machineUpdateSchema,
  parseJsonValue,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { initializeWorkspaceMachines as initializeWorkspaceMachineTable } from "./db/migrations/initialize-workspace-machines";
import { HttpError, json, parseJson } from "./http";
import { machinesDeleteDeleteMachine } from "./queries/machines/delete-delete-machine";
import { machinesFindReadMachines } from "./queries/machines/find-read-machines";
import { machinesInsertCreateMachine } from "./queries/machines/insert-create-machine";
import { machinesInsertInitializeWorkspaceMachines } from "./queries/machines/insert-initialize-workspace-machines";
import { machinesUpdateUpdateMachine } from "./queries/machines/update-update-machine";

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
  initializeWorkspaceMachineTable(storage);
  const now = new Date().toISOString();
  machinesInsertInitializeWorkspaceMachines(storage, {
    machineId: "00000000-0000-4000-8000-000000000001",
    name: "Cloudflare Computer",
    capabilitiesJson: JSON.stringify(["browser", "screen"]),
    agentIdsJson: JSON.stringify(["brand", "prospector", "setup"]),
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  });
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
  machinesInsertCreateMachine(storage, {
    machineId: id,
    name: input.name,
    kind: input.kind,
    status: input.kind === "cloudflare" ? "online" : "pairing",
    endpoint: input.endpoint ?? null,
    capabilitiesJson: JSON.stringify(input.capabilities),
    agentIdsJson: "[]",
    createdAt: now,
    updatedAt: now,
  });
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
  machinesUpdateUpdateMachine(storage, {
    name: input.name,
    capabilitiesJson: JSON.stringify(input.capabilities),
    agentIdsJson: JSON.stringify(input.agentIds),
    updatedAt: now,
    machineId: id,
  });
  return json(requireMachine(storage, workspaceId, id));
}

function deleteMachine(storage: DurableObjectStorage, request: Request) {
  const id = machineId(request);
  const result = machinesDeleteDeleteMachine(storage, id);
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
  return [...machinesFindReadMachines<MachineRow>(storage)].map((row) =>
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
