import fs from "node:fs";
import path from "node:path";

const TEN_MINUTES = 10 * 60 * 1000;
const STORE_PATH = path.join("/tmp", "chief-desktop-pkce.json");

interface PendingDesktopPkce {
  redirectToken: string;
  createdAt: number;
}

type PendingDesktopPkceStore = Record<string, PendingDesktopPkce>;

function readStore(): PendingDesktopPkceStore {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    return JSON.parse(raw) as PendingDesktopPkceStore;
  } catch {
    return {};
  }
}

function writeStore(store: PendingDesktopPkceStore) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store), "utf8");
}

function pruneExpiredEntries(store: PendingDesktopPkceStore, now = Date.now()) {
  for (const [state, entry] of Object.entries(store)) {
    if (now - entry.createdAt > TEN_MINUTES) {
      delete store[state];
    }
  }
}

export function storePendingDesktopPkce(state: string, redirectToken: string) {
  const store = readStore();
  pruneExpiredEntries(store);
  store[state] = {
    redirectToken,
    createdAt: Date.now(),
  };
  writeStore(store);
}

export function getPendingDesktopPkce(state: string): string | null {
  const store = readStore();
  pruneExpiredEntries(store);
  writeStore(store);
  return store[state]?.redirectToken ?? null;
}
