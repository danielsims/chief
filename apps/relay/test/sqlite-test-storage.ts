import { runInDurableObject } from "cloudflare:test";

import { relayTestEnv } from "./helpers";

export async function withWorkspaceStorage<T>(
  run: (storage: DurableObjectStorage) => Promise<T> | T,
) {
  const env = relayTestEnv();
  const stub = env.WORKSPACES.get(
    env.WORKSPACES.idFromName(crypto.randomUUID()),
  );
  return runInDurableObject(stub, async (_instance, state) => {
    try {
      return await run(state.storage);
    } finally {
      await state.storage.deleteAlarm();
    }
  });
}
