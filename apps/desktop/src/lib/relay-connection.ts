import { ZodError } from "zod";

import type { WorkspaceSummary } from "@chief/relay-contracts";
import {
  isJsonObject,
  isJsonString,
  parseJsonObject,
  parseJsonValue,
  relayDiscoverySchema,
  workspaceSummarySchema,
} from "@chief/relay-contracts";

export interface StoredRelayConnection {
  version: 1;
  relayUrl: string;
  authBaseUrl: string;
  authUiUrl: string;
}

export interface ConnectedWorkspace {
  relayUrl: string;
  accountId: string;
  summary: WorkspaceSummary;
}

interface StoredRelayDirectory {
  version: 2;
  activeRelayUrl: string | null;
  connections: StoredRelayConnection[];
  workspaces: Record<
    string,
    { accountId: string; relayUrl: string; summary: WorkspaceSummary }
  >;
}

const legacyStorageKey = "chief.relay-connection.v1";
const legacyDirectoryStorageKey = "chief.relay-directory.v1";
const storageKey = "chief.relay-directory.v2";

function emptyDirectory(): StoredRelayDirectory {
  return {
    version: 2,
    activeRelayUrl: null,
    connections: [],
    workspaces: {},
  };
}

function readDirectory(): StoredRelayDirectory {
  try {
    const raw = globalThis.localStorage.getItem(storageKey);
    if (raw) {
      const parsed = parseJsonObject(JSON.parse(raw)) ?? {};
      const connections = Array.isArray(parsed.connections)
        ? parsed.connections
            .map(parseStoredRelayConnection)
            .filter((value): value is StoredRelayConnection => value !== null)
        : [];
      const activeRelayUrl = isJsonString(parsed.activeRelayUrl)
        ? normalizedRelayOrigin(parsed.activeRelayUrl)
        : null;
      const workspaces =
        parsed.workspaces && isJsonObject(parsed.workspaces)
          ? Object.fromEntries(
              Object.entries(parsed.workspaces).flatMap(
                ([workspaceId, value]) => {
                  try {
                    if (!isJsonObject(value)) return [];
                    if (
                      !isJsonString(value.accountId) ||
                      !isJsonString(value.relayUrl)
                    )
                      return [];
                    const summary = workspaceSummarySchema.parse(value.summary);
                    return [
                      [
                        workspaceId,
                        {
                          accountId: value.accountId,
                          relayUrl: normalizedRelayOrigin(value.relayUrl),
                          summary,
                        },
                      ],
                    ];
                  } catch {
                    return [];
                  }
                },
              ),
            )
          : {};
      return { version: 2, activeRelayUrl, connections, workspaces };
    }
    const legacyDirectory = globalThis.localStorage.getItem(
      legacyDirectoryStorageKey,
    );
    if (legacyDirectory) {
      const parsed = parseJsonObject(JSON.parse(legacyDirectory)) ?? {};
      const connections = Array.isArray(parsed.connections)
        ? parsed.connections
            .map(parseStoredRelayConnection)
            .filter((value): value is StoredRelayConnection => value !== null)
        : [];
      const activeRelayUrl = isJsonString(parsed.activeRelayUrl)
        ? normalizedRelayOrigin(parsed.activeRelayUrl)
        : null;
      const migrated = {
        ...emptyDirectory(),
        activeRelayUrl,
        connections,
      };
      writeDirectory(migrated);
      globalThis.localStorage.removeItem(legacyDirectoryStorageKey);
      return migrated;
    }
    const legacy = globalThis.localStorage.getItem(legacyStorageKey);
    if (legacy) {
      const connection = parseStoredRelayConnection(parseJsonValue(legacy));
      if (connection) {
        const migrated = {
          ...emptyDirectory(),
          activeRelayUrl: connection.relayUrl,
          connections: [connection],
        };
        writeDirectory(migrated);
        globalThis.localStorage.removeItem(legacyStorageKey);
        return migrated;
      }
    }
  } catch {
    // Corrupt client preferences never become connection authority.
  }
  return emptyDirectory();
}

function writeDirectory(directory: StoredRelayDirectory) {
  globalThis.localStorage.setItem(storageKey, JSON.stringify(directory));
}

export function readStoredRelayConnection(): StoredRelayConnection | null {
  const directory = readDirectory();
  if (!directory.activeRelayUrl) return null;
  return (
    directory.connections.find(
      (connection) => connection.relayUrl === directory.activeRelayUrl,
    ) ?? null
  );
}

export function saveStoredRelayConnection(
  connection: StoredRelayConnection | null,
) {
  const directory = readDirectory();
  if (connection) {
    const connections = directory.connections.filter(
      (candidate) => candidate.relayUrl !== connection.relayUrl,
    );
    connections.push(connection);
    writeDirectory({
      ...directory,
      activeRelayUrl: connection.relayUrl,
      connections,
    });
    return;
  }
  writeDirectory({ ...directory, activeRelayUrl: null });
}

/** Add or refresh a relay without changing the workspace currently in use. */
export function rememberRelayConnection(connection: StoredRelayConnection) {
  const directory = readDirectory();
  writeDirectory({
    ...directory,
    connections: [
      ...directory.connections.filter(
        (candidate) => candidate.relayUrl !== connection.relayUrl,
      ),
      connection,
    ],
  });
}

export function knownRelayConnections() {
  return readDirectory().connections;
}

export function forgetRelayConnection(relayUrl: string) {
  const normalized = normalizedRelayOrigin(relayUrl);
  const directory = readDirectory();
  writeDirectory({
    ...directory,
    activeRelayUrl:
      directory.activeRelayUrl === normalized ? null : directory.activeRelayUrl,
    connections: directory.connections.filter(
      (connection) => connection.relayUrl !== normalized,
    ),
  });
}

export function isMissingRelayError(error: unknown) {
  if (error instanceof SyntaxError || error instanceof ZodError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP 404\b|HTTP 410\b|unsupported account issuer/u.test(message);
}

export async function probeRelayReachability(
  relayUrl: string,
  fetcher: typeof fetch,
): Promise<"ok" | "missing" | "unreachable"> {
  try {
    await validateRelayConnection(relayUrl, fetcher);
    return "ok";
  } catch (error) {
    return isMissingRelayError(error) ? "missing" : "unreachable";
  }
}

export async function forgetMissingConnectedRelays(input: {
  identities: readonly { relayUrl: string; user: { id: string } }[];
  chiefCloudRelayUrl: string;
  fetcher?: typeof fetch;
  forgetSession: (relayUrl: string) => Promise<void>;
}): Promise<string[]> {
  const cloud = new URL(input.chiefCloudRelayUrl).origin;
  const fetcher = input.fetcher ?? fetch;
  const removed: string[] = [];
  for (const identity of input.identities) {
    if (identity.relayUrl === cloud) continue;
    const reachability = await probeRelayReachability(
      identity.relayUrl,
      fetcher,
    );
    if (reachability !== "missing") continue;
    await input.forgetSession(identity.relayUrl);
    forgetRelayWorkspaces(identity.relayUrl, identity.user.id);
    forgetRelayConnection(identity.relayUrl);
    removed.push(identity.relayUrl);
  }
  return removed;
}

export function resolveRelayConnection(
  relayUrl: string,
  connections: readonly StoredRelayConnection[],
  chiefCloud: StoredRelayConnection,
) {
  const normalized = normalizedRelayOrigin(relayUrl);
  if (normalized === chiefCloud.relayUrl) return chiefCloud;
  return (
    connections.find((connection) => connection.relayUrl === normalized) ?? null
  );
}

export function rememberRelayWorkspaces(
  relayUrl: string,
  accountId: string,
  workspaces: WorkspaceSummary[],
) {
  const directory = readDirectory();
  const normalized = normalizedRelayOrigin(relayUrl);
  const retained = Object.fromEntries(
    Object.entries(directory.workspaces).filter(
      ([, value]) =>
        value.accountId !== accountId || value.relayUrl !== normalized,
    ),
  );
  writeDirectory({
    ...directory,
    workspaces: {
      ...retained,
      ...Object.fromEntries(
        workspaces.map((summary) => [
          workspaceDirectoryKey(normalized, accountId, summary.id),
          { accountId, relayUrl: normalized, summary },
        ]),
      ),
    },
  });
}

export function forgetRelayWorkspaces(relayUrl: string, accountId: string) {
  const directory = readDirectory();
  const normalized = normalizedRelayOrigin(relayUrl);
  writeDirectory({
    ...directory,
    workspaces: Object.fromEntries(
      Object.entries(directory.workspaces).filter(
        ([, workspace]) =>
          workspace.relayUrl !== normalized ||
          workspace.accountId !== accountId,
      ),
    ),
  });
}

export function relayForWorkspace(
  accountId: string,
  workspaceId: string,
  relayUrl?: string,
) {
  const expectedRelay = relayUrl ? normalizedRelayOrigin(relayUrl) : undefined;
  const matches = Object.values(readDirectory().workspaces).filter(
    (entry) =>
      entry.accountId === accountId &&
      entry.summary.id === workspaceId &&
      (!expectedRelay || entry.relayUrl === expectedRelay),
  );
  return matches.length === 1 ? (matches[0]?.relayUrl ?? null) : null;
}

export function knownWorkspaceSummaries(
  relayUrl: string,
  accountId: string | null,
) {
  if (!accountId) return [];
  const normalized = normalizedRelayOrigin(relayUrl);
  return Object.values(readDirectory().workspaces)
    .filter(
      (entry) => entry.accountId === accountId && entry.relayUrl === normalized,
    )
    .map((entry) => entry.summary);
}

export function knownWorkspacesForRelayIdentities(
  identities: readonly { relayUrl: string; user: { id: string } }[],
): ConnectedWorkspace[] {
  const allowed = new Set(
    identities.map(
      (identity) =>
        `${normalizedRelayOrigin(identity.relayUrl)}:${identity.user.id}`,
    ),
  );
  return Object.values(readDirectory().workspaces).filter((entry) =>
    allowed.has(`${entry.relayUrl}:${entry.accountId}`),
  );
}

export function workspaceForRelayIdentities(
  workspaceId: string,
  identities: readonly { relayUrl: string; user: { id: string } }[],
): ConnectedWorkspace | null {
  const matches = knownWorkspacesForRelayIdentities(identities).filter(
    (workspace) => workspace.summary.id === workspaceId,
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function workspaceDirectoryKey(
  relayUrl: string,
  accountId: string,
  workspaceId: string,
) {
  return `${encodeURIComponent(relayUrl)}:${accountId}:${workspaceId}`;
}

export function activateKnownRelay(relayUrl: string) {
  const normalized = normalizedRelayOrigin(relayUrl);
  const directory = readDirectory();
  const connection = directory.connections.find(
    (candidate) => candidate.relayUrl === normalized,
  );
  if (!connection)
    throw new Error("This relay has not been verified on this device.");
  writeDirectory({ ...directory, activeRelayUrl: normalized });
}

export async function validateRelayConnection(
  value: string,
  fetcher: typeof fetch,
): Promise<StoredRelayConnection> {
  const relayUrl = normalizedRelayOrigin(value);
  const response = await fetcher(new URL("/.well-known/relay", relayUrl), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`This relay returned HTTP ${response.status}.`);
  }
  const discovery = relayDiscoverySchema.parse(await response.json());
  const issuer = new URL(discovery.authentication.accountIssuer);
  if (issuer.pathname.replace(/\/$/u, "") !== "/api/auth") {
    throw new Error("This relay advertises an unsupported account issuer.");
  }
  assertSecureEndpoint(issuer);
  return {
    version: 1,
    relayUrl,
    authBaseUrl: issuer.origin,
    authUiUrl: issuer.origin,
  };
}

function parseStoredRelayConnection(
  value: unknown,
): StoredRelayConnection | null {
  if (!value || !isJsonObject(value)) return null;
  const record = value;
  if (
    record.version !== 1 ||
    !isJsonString(record.relayUrl) ||
    !isJsonString(record.authBaseUrl) ||
    !isJsonString(record.authUiUrl)
  ) {
    return null;
  }
  try {
    return {
      version: 1,
      relayUrl: normalizedRelayOrigin(record.relayUrl),
      authBaseUrl: normalizedRelayOrigin(record.authBaseUrl),
      authUiUrl: normalizedRelayOrigin(record.authUiUrl),
    };
  } catch {
    return null;
  }
}

function normalizedRelayOrigin(value: string) {
  const url = new URL(relayAddressWithScheme(value));
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new Error(
      "Enter only the relay origin, without a path or credentials.",
    );
  }
  assertSecureEndpoint(url);
  return url.origin;
}

function relayAddressWithScheme(value: string) {
  const address = value.trim();
  if (/^[a-z][a-z\d+.-]*:\/\//iu.test(address)) return address;
  if (/^(?:localhost|127\.0\.0\.1)(?::|\/|$)/iu.test(address)) {
    return `http://${address}`;
  }
  return `https://${address}`;
}

function assertSecureEndpoint(url: URL) {
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(
      "Custom relays must use HTTPS; HTTP is allowed only on localhost.",
    );
  }
}
