import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type {
  Database,
  DatabasePerson,
  DatabaseRow,
  DatabaseRowSave,
  DatabaseSave,
  DatabaseWithRows,
} from "@chief/relay-contracts";
import {
  agentIdSchema,
  databaseSchema,
  userIdSchema,
} from "@chief/relay-contracts";

import type { DatabasePersonOption } from "./database-model";
import { useAuth } from "../../lib/auth/auth-context";
import { parseRelayError } from "../../lib/relay-runtime-errors";
import { useRelaySession } from "../../lib/relay-session-context";
import { useRuntime } from "../../lib/runtime";
import { useWorkspaceUsers } from "../chat/mention-people-context";

function failure(error: Error, fallback: string) {
  return error.message || fallback;
}

type DatabasesClient = NonNullable<
  ReturnType<typeof useRelaySession>["client"]
>["databases"];

// What was last read of each database, so opening one again shows it at
// once while a fresh copy is read. Keyed by workspace, since every
// workspace has a board with the same id.
const cache = new Map<string, DatabaseWithRows>();
const reads = new Map<string, Promise<DatabaseWithRows>>();

function readDatabase(
  databases: DatabasesClient,
  key: string,
  databaseId: string,
) {
  const pending = reads.get(key);
  if (pending) return pending;
  const read = databases
    .get(databaseId)
    .then((next) => {
      cache.set(key, next);
      return next;
    })
    .finally(() => reads.delete(key));
  reads.set(key, read);
  return read;
}

/** Starts reading a database before it's opened, such as on hover. */
export function usePrefetchDatabase() {
  const { client, snapshot } = useRelaySession();
  return (databaseId: string) => {
    const key = `${snapshot?.id}:${databaseId}`;
    if (client && snapshot && !cache.has(key))
      // A failed prefetch is only a slower open; the view reports errors.
      void readDatabase(client.databases, key, databaseId).catch(
        () => undefined,
      );
  };
}

function byPosition(rows: DatabaseRow[]) {
  return [...rows].sort((left, right) => left.position - right.position);
}

/**
 * One database and its rows, kept fresh while it's open. Changes show at
 * once and are confirmed by the save; refreshes wait while one is in flight,
 * so an older copy never overwrites it.
 */
export function useDatabase(databaseId: string) {
  const { client, snapshot } = useRelaySession();
  const key = `${snapshot?.id}:${databaseId}`;
  const [data, setData] = useState<DatabaseWithRows | null>(
    () => cache.get(key) ?? null,
  );
  const [error, setError] = useState("");
  const busy = useRef(0);

  // Local changes are remembered too, so reopening shows them.
  useEffect(() => {
    if (data) cache.set(key, data);
  }, [data, key]);

  const refresh = useCallback(() => {
    if (!client || busy.current) return;
    void readDatabase(client.databases, key, databaseId).then(
      (next) => {
        if (busy.current) return;
        setData(next);
        setError("");
      },
      (cause) =>
        setError(
          failure(
            parseRelayError(cause),
            "Couldn't load this. Check your connection.",
          ),
        ),
    );
  }, [client, databaseId, key]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  const run = useCallback(
    async <T>(work: () => Promise<T>, message: string) => {
      busy.current += 1;
      try {
        return await work();
      } catch (cause) {
        toast.error(failure(parseRelayError(cause), message));
        return undefined;
      } finally {
        busy.current -= 1;
      }
    },
    [],
  );

  const placeRow = (row: DatabaseRow) =>
    setData((current) =>
      current
        ? {
            ...current,
            rows: byPosition([
              ...current.rows.filter((other) => other.id !== row.id),
              row,
            ]),
          }
        : current,
    );

  const saveRow = async (change: DatabaseRowSave) => {
    if (!client) return undefined;
    const saved = await run(
      () => client.databases.saveRow(databaseId, change),
      "Couldn't save that.",
    );
    if (saved) placeRow(saved);
    else refresh();
    return saved;
  };

  const removeRow = async (row: DatabaseRow) => {
    if (!client) return;
    setData((current) =>
      current
        ? {
            ...current,
            rows: current.rows.filter((other) => other.id !== row.id),
          }
        : current,
    );
    const removed = await run(
      () => client.databases.removeRow(databaseId, row.id),
      "Couldn't delete that.",
    );
    if (!removed) refresh();
  };

  const saveDatabase = async (
    change: Omit<DatabaseSave, "id">,
    message = "Couldn't save that change.",
  ) => {
    if (!client) return false;
    const saved = await run(
      () => client.databases.save({ ...change, id: databaseId }),
      message,
    );
    if (!saved) return false;
    setData((current) => (current ? { ...current, database: saved } : current));
    // Changing fields can empty cells, so rows are read again.
    if (change.fields) refresh();
    return true;
  };

  return {
    data,
    error,
    saveRow,
    removeRow,
    saveDatabase,
    /** Shows a row where it's going before the save confirms it. */
    placeRow,
    /** Holds refreshes while something is being dragged. */
    hold: () => {
      busy.current += 1;
      return () => {
        busy.current -= 1;
      };
    },
  };
}

export type DatabaseState = ReturnType<typeof useDatabase>;

/** Who a person cell can hold: people first, then agents. */
export function usePeople(): DatabasePersonOption[] {
  const users = useWorkspaceUsers();
  const { user } = useAuth();
  const { agents } = useRuntime();
  // You can always be assigned, before the member list arrives.
  const people =
    user && !users.has(user.id)
      ? [user, ...users.values()]
      : [...users.values()];
  const candidates: (DatabasePerson & { name: string; image?: string })[] = [
    ...people.flatMap((user) => {
      const id = userIdSchema.safeParse(user.id);
      return id.success
        ? [
            {
              kind: "user" as const,
              id: id.data,
              name: user.name,
              image: user.image,
            },
          ]
        : [];
    }),
    ...agents
      .flatMap((agent) => [agent, ...(agent.subagents ?? [])])
      .flatMap(({ id, name }) => {
        const agentId = agentIdSchema.safeParse(id);
        return agentId.success
          ? [{ kind: "agent" as const, id: agentId.data, name }]
          : [];
      }),
  ];
  return candidates.map(({ image, ...person }) => ({
    ...person,
    ...(image ? { image } : undefined),
  }));
}

const databasesChanged = "chief:databases-changed";

/** Tells every open list of databases to read again, after one is added or removed. */
export function announceDatabasesChanged() {
  window.dispatchEvent(new Event(databasesChanged));
}

/** The databases in a channel, or every one you can use. */
// The last list read per workspace/channel, so a remounted view (a channel's
// tabs, say) and the next app load show real names at once instead of
// placeholders until the read lands.
const listedForChannel = new Map<string, Database[]>();
const listedForWorkspace = new Map<string, Database[]>();
const cachePrefix = "chief.databases:";

function cacheKey(workspaceId: string | undefined, conversationId?: string) {
  return workspaceId
    ? `${cachePrefix}${workspaceId}:${conversationId ?? "all"}`
    : undefined;
}

function readStored(key: string | undefined) {
  if (!key) return undefined;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = databaseSchema.array().safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function writeStored(key: string | undefined, databases: Database[]) {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(databases));
  } catch {
    // A stale cache is only a slower first paint.
  }
}

function cachedDatabases(
  workspaceId: string | undefined,
  conversationId?: string,
) {
  if (!workspaceId) return undefined;
  const key = cacheKey(workspaceId, conversationId);
  if (!key) return undefined;
  const memory = conversationId
    ? listedForChannel.get(key)
    : listedForWorkspace.get(workspaceId);
  if (memory) return memory;
  const stored = readStored(key);
  if (stored) {
    if (conversationId) listedForChannel.set(key, stored);
    else listedForWorkspace.set(workspaceId, stored);
    return stored;
  }
  if (conversationId) {
    const all =
      listedForWorkspace.get(workspaceId) ?? readStored(cacheKey(workspaceId));
    if (all)
      return all.filter(
        (database) => database.conversationId === conversationId,
      );
  }
  return undefined;
}

export function useDatabases(conversationId?: string) {
  const { client, snapshot } = useRelaySession();
  const workspaceId = snapshot?.id;
  const initial = cachedDatabases(workspaceId, conversationId);
  const [databases, setDatabases] = useState<Database[]>(initial ?? []);
  const [loaded, setLoaded] = useState(Boolean(initial));

  useEffect(() => {
    if (!client) return;
    let live = true;
    const key = cacheKey(workspaceId, conversationId);
    const workspaceKey = cacheKey(workspaceId);
    const load = () =>
      void client.databases.list(conversationId).then(
        (next) => {
          if (!live) return;
          if (conversationId) {
            if (key) listedForChannel.set(key, next);
            // Keep the workspace-wide list fresh when one is already cached.
            const all =
              listedForWorkspace.get(workspaceId ?? "") ??
              readStored(workspaceKey);
            if (all && workspaceId) {
              const merged = [
                ...all.filter(
                  (database) => database.conversationId !== conversationId,
                ),
                ...next,
              ];
              listedForWorkspace.set(workspaceId, merged);
              writeStored(workspaceKey, merged);
            }
          } else if (workspaceId) {
            listedForWorkspace.set(workspaceId, next);
            writeStored(workspaceKey, next);
          }
          writeStored(key, next);
          setDatabases(next);
          setLoaded(true);
        },
        () => {
          if (live) setLoaded(true);
        },
      );
    load();
    window.addEventListener(databasesChanged, load);
    return () => {
      live = false;
      window.removeEventListener(databasesChanged, load);
    };
  }, [client, conversationId, workspaceId]);
  // A list read for another channel never shows here.
  return {
    databases: conversationId
      ? databases.filter(
          (database) => database.conversationId === conversationId,
        )
      : databases,
    loaded,
  };
}
