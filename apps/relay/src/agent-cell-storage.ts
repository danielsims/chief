import type {
  CellKVRecord,
  CellKVStore,
} from "@chief/agent-runtime/cells/cloudflare";
import { CellStoragePersistence } from "@chief/agent-runtime/cells/cloudflare";

export function agentCellPersistence(storage: DurableObjectStorage) {
  const adapter: CellKVStore = {
    get: async (key) => await storage.get(key),
    put: async (key, value) => await storage.put(key, value),
    delete: async (key) => {
      await storage.delete(key);
    },
    list: async () =>
      [...(await storage.list<CellKVRecord>()).entries()].map(
        ([key, value]) => ({
          key,
          value,
        }),
      ),
  };
  return new CellStoragePersistence(adapter);
}
