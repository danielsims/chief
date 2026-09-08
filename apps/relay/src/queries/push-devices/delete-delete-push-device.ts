import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { pushDevices } from "../../db/schema/push-devices";

export function pushDevicesDeleteDeletePushDevice(
  storage: DurableObjectStorage,
  token: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(db.delete(pushDevices).where(eq(pushDevices.token, token))),
  );
}
