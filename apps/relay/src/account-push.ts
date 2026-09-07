import {
  registerPushDeviceCommandSchema,
  registerPushDeviceResultSchema,
  unregisterPushDeviceCommandSchema,
} from "@chief/relay-contracts";

import { apnsReady } from "./apns-client";
import { json, parseJson } from "./http";

export async function registerPushDevice(
  storage: DurableObjectStorage,
  request: Request,
  env: Env,
) {
  const command = registerPushDeviceCommandSchema.parse(
    await parseJson(request),
  );
  const updatedAt = new Date().toISOString();
  storage.sql.exec(
    `INSERT INTO push_devices (token, environment, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET
       environment = excluded.environment,
       updated_at = excluded.updated_at`,
    command.token.toLowerCase(),
    command.environment,
    updatedAt,
  );
  return json(
    registerPushDeviceResultSchema.parse({
      token: command.token.toLowerCase(),
      environment: command.environment,
      updatedAt,
      apnsConfigured: apnsReady(env),
    }),
  );
}

export function listPushDevices(storage: DurableObjectStorage) {
  const devices = storage.sql
    .exec<{ token: string; environment: string }>(
      "SELECT token, environment FROM push_devices ORDER BY updated_at DESC",
    )
    .toArray();
  return json({ devices });
}

export async function deletePushDevice(
  storage: DurableObjectStorage,
  request: Request,
) {
  const command = unregisterPushDeviceCommandSchema.parse(
    await parseJson(request),
  );
  storage.sql.exec(
    "DELETE FROM push_devices WHERE token = ?",
    command.token.toLowerCase(),
  );
  return json({ token: command.token.toLowerCase(), deleted: true });
}
