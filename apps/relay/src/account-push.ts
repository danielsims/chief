import {
  registerPushDeviceCommandSchema,
  registerPushDeviceResultSchema,
  unregisterPushDeviceCommandSchema,
} from "@chief/relay-contracts";

import { apnsReady } from "./apns-client";
import { json, parseJson } from "./http";
import { pushDevicesDeleteDeletePushDevice } from "./queries/push-devices/delete-delete-push-device";
import { pushDevicesFindListPushDevices } from "./queries/push-devices/find-list-push-devices";
import { pushDevicesInsertRegisterPushDevice } from "./queries/push-devices/insert-register-push-device";

export async function registerPushDevice(
  storage: DurableObjectStorage,
  request: Request,
  env: Env,
) {
  const command = registerPushDeviceCommandSchema.parse(
    await parseJson(request),
  );
  const updatedAt = new Date().toISOString();
  pushDevicesInsertRegisterPushDevice(storage, {
    token: command.token.toLowerCase(),
    environment: command.environment,
    updatedAt: updatedAt,
  });
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
  const devices = pushDevicesFindListPushDevices<{
    token: string;
    environment: string;
  }>(storage);
  return json({ devices });
}

export async function deletePushDevice(
  storage: DurableObjectStorage,
  request: Request,
) {
  const command = unregisterPushDeviceCommandSchema.parse(
    await parseJson(request),
  );
  pushDevicesDeleteDeletePushDevice(storage, command.token.toLowerCase());
  return json({ token: command.token.toLowerCase(), deleted: true });
}
