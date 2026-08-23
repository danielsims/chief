import type { WorkspaceSummary } from "@chief/relay-contracts";
import {
  relayDiscoverySchema,
  workspaceSummarySchema,
} from "@chief/relay-contracts";

export interface StoredRelayConnection {
  version: 1;
  relayUrl: string;
  authBaseUrl: string;
  authUiUrl: string;
}

interface StoredRelayDirectory {
  version: 1;
  activeRelayUrl: string | null;
  connections: StoredRelayConnection[];
  workspaces: Record<string, { relayUrl: string; summary: WorkspaceSummary }>;
}

const legacyStorageKey = "chief.relay-connection.v1";
const storageKey = "chief.relay-directory.v1";

function emptyDirectory(): StoredRelayDirectory {
  return {
    version: 1,
    activeRelayUrl: null,
    connections: [],
    workspaces: {},
  };
}

function readDirectory(): StoredRelayDirectory {
  try {
    const raw = globalThis.localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredRelayDirectory>;
      const connections = Array.isArray(parsed.connections)
        ? parsed.connections
            .map(parseStoredRelayConnection)
            .filter((value): value is StoredRelayConnection => value !== null)
        : [];
      const activeRelayUrl =
        typeof parsed.activeRelayUrl === "string"
          ? normalizedRelayOrigin(parsed.activeRelayUrl)
          : null;
      const workspaces =
        parsed.workspaces && typeof parsed.workspaces === "object"
          ? Object.fromEntries(
              Object.entries(parsed.workspaces).flatMap(
                ([workspaceId, value]) => {
                  try {
                    const record = value as {
                      relayUrl?: unknown;
                      summary?: unknown;
                    };
                    if (typeof record.relayUrl !== "string") return [];
                    const summary = workspaceSummarySchema.parse(
                      record.summary,
                    );
                    return [
                      [
                        workspaceId,
                        {
                          relayUrl: normalizedRelayOrigin(record.relayUrl),
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
      return { version: 1, activeRelayUrl, connections, workspaces };
    }
    const legacy = globalThis.localStorage.getItem(legacyStorageKey);
    if (legacy) {
      const connection = parseStoredRelayConnection(
        JSON.parse(legacy) as unknown,
      );
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
  workspaces: WorkspaceSummary[],
) {
  const directory = readDirectory();
  const normalized = normalizedRelayOrigin(relayUrl);
  const retained = Object.fromEntries(
    Object.entries(directory.workspaces).filter(
      ([, value]) => value.relayUrl !== normalized,
    ),
  );
  writeDirectory({
    ...directory,
    workspaces: {
      ...retained,
      ...Object.fromEntries(
        workspaces.map((summary) => [
          summary.id,
          { relayUrl: normalized, summary },
        ]),
      ),
    },
  });
}

export function relayForWorkspace(workspaceId: string) {
  return readDirectory().workspaces[workspaceId]?.relayUrl ?? null;
}

export function knownWorkspaceSummaries() {
  return Object.values(readDirectory().workspaces).map(
    (entry) => entry.summary,
  );
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
  const response = await fetcher(
    new URL("/.well-known/chief-relay", relayUrl),
    {
      headers: { accept: "application/json" },
    },
  );
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
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.relayUrl !== "string" ||
    typeof record.authBaseUrl !== "string" ||
    typeof record.authUiUrl !== "string"
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
