import {
  isJsonBoolean,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonValue,
} from "@chief/relay-contracts";

import type { StoredSession } from "./session";

const STORAGE_KEY = "chief.account-directory.v1";

export interface RelayAccountIdentity {
  relayUrl: string;
  user: StoredSession["user"];
  lastUsedAt: number;
}

interface AccountDirectory {
  version: 1;
  activeUserByRelay: Record<string, string>;
  identities: RelayAccountIdentity[];
}

function emptyDirectory(): AccountDirectory {
  return {
    version: 1,
    activeUserByRelay: {},
    identities: [],
  };
}

export function rememberRelayAccount(
  relayUrl: string,
  user: StoredSession["user"],
): RelayAccountIdentity {
  const relayOrigin = new URL(relayUrl).origin;
  const directory = readDirectory();
  const identity: RelayAccountIdentity = {
    relayUrl: relayOrigin,
    user,
    lastUsedAt: Date.now(),
  };
  writeDirectory({
    version: 1,
    activeUserByRelay: {
      ...directory.activeUserByRelay,
      [relayOrigin]: user.id,
    },
    identities: [
      ...directory.identities.filter(
        (candidate) => candidate.relayUrl !== relayOrigin,
      ),
      identity,
    ],
  });
  return identity;
}

export function connectedRelayIdentities(): RelayAccountIdentity[] {
  return latestIdentityPerRelay(readDirectory().identities).sort(
    (left, right) => right.lastUsedAt - left.lastUsedAt,
  );
}

export function relayIdentity(relayUrl: string): RelayAccountIdentity | null {
  const relayOrigin = new URL(relayUrl).origin;
  return (
    latestIdentityPerRelay(readDirectory().identities).find(
      (identity) => identity.relayUrl === relayOrigin,
    ) ?? null
  );
}

export function activeRelayUserId(relayUrl: string): string | null {
  const relayOrigin = new URL(relayUrl).origin;
  return (
    relayIdentity(relayOrigin)?.user.id ??
    readDirectory().activeUserByRelay[relayOrigin] ??
    null
  );
}

export function secureSessionAccount(relayUrl: string, userId: string): string {
  return `${new URL(relayUrl).origin}::${userId}`;
}

export function forgetRelayIdentity(
  relayUrl: string,
): RelayAccountIdentity | null {
  const relayOrigin = new URL(relayUrl).origin;
  const directory = readDirectory();
  const removed =
    latestIdentityPerRelay(directory.identities).find(
      (identity) => identity.relayUrl === relayOrigin,
    ) ?? null;
  if (!removed) return null;
  const retained = directory.identities.filter(
    (identity) => identity.relayUrl !== relayOrigin,
  );
  const activeUserByRelay = { ...directory.activeUserByRelay };
  delete activeUserByRelay[relayOrigin];
  writeDirectory({
    version: 1,
    activeUserByRelay,
    identities: retained,
  });
  return removed;
}

export function resetAccountDirectoryForTests(): void {
  globalThis.localStorage.removeItem(STORAGE_KEY);
}

function readDirectory(): AccountDirectory {
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    const value = raw ? parseJsonValue(JSON.parse(raw)) : undefined;
    if (!isJsonObject(value) || value.version !== 1) return emptyDirectory();
    const identities = Array.isArray(value.identities)
      ? value.identities.flatMap((candidate) => {
          const parsed = parseIdentity(candidate);
          return parsed ? [parsed] : [];
        })
      : [];
    const activeUserByRelay = isJsonObject(value.activeUserByRelay)
      ? Object.fromEntries(
          Object.entries(value.activeUserByRelay).filter(
            (entry): entry is [string, string] => isJsonString(entry[1]),
          ),
        )
      : {};
    return {
      version: 1,
      activeUserByRelay,
      identities,
    };
  } catch {
    return emptyDirectory();
  }
}

function writeDirectory(directory: AccountDirectory): void {
  globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(directory));
}

function latestIdentityPerRelay(
  identities: RelayAccountIdentity[],
): RelayAccountIdentity[] {
  const latestByRelay = new Map<string, RelayAccountIdentity>();
  for (const identity of identities) {
    const current = latestByRelay.get(identity.relayUrl);
    if (!current || identity.lastUsedAt > current.lastUsedAt) {
      latestByRelay.set(identity.relayUrl, identity);
    }
  }
  return [...latestByRelay.values()];
}

function parseIdentity(value: unknown): RelayAccountIdentity | null {
  if (!isJsonObject(value) || !isJsonObject(value.user)) return null;
  const { user } = value;
  if (
    !isJsonString(value.relayUrl) ||
    !isJsonNumber(value.lastUsedAt) ||
    !isJsonString(user.id) ||
    !isJsonString(user.name) ||
    !isJsonString(user.email) ||
    !isJsonBoolean(user.emailVerified) ||
    (user.image !== undefined && !isJsonString(user.image))
  ) {
    return null;
  }
  return {
    relayUrl: new URL(value.relayUrl).origin,
    lastUsedAt: value.lastUsedAt,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
    },
  };
}
