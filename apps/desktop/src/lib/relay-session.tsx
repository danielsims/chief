import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  CreateWorkspaceCommand,
  WorkspaceInvite,
  WorkspaceInviteClaimResult,
  WorkspaceSnapshot,
  WorkspaceSummary,
} from "@chief/relay-contracts";
import { RelayClient } from "@chief/relay-client";

import { useAuth } from "./auth/auth-context";
import {
  CHIEF_CLOUD_AUTH_BASE_URL,
  CHIEF_CLOUD_AUTH_UI_URL,
  CHIEF_CLOUD_RELAY_URL,
  RELAY_URL,
} from "./config";
import { ensureDesktopCells } from "./desktop-cell-runtime";
import {
  clearPendingOrganizationInvitation,
  readPendingOrganizationInvitation,
} from "./organization-invitation";
import {
  knownRelayConnections,
  knownWorkspaceSummaries,
  relayForWorkspace,
  rememberRelayWorkspaces,
  resolveRelayConnection,
} from "./relay-connection";
import {
  activeRelayWorkspace,
  connectBoundRelayDevice,
  relaySessionTransport,
} from "./relay-session-api";
import { setRelayWorkspaceOverride } from "./relay-workspace-override";
import {
  clearWorkspaceSwitch,
  findRecoveryWorkspace,
  pendingWorkspaceSwitch,
  previousWorkspaceSwitch,
  rememberConnectedWorkspace,
  rememberWorkspaceSwitch,
} from "./workspace-switch-state";

interface RelaySessionValue {
  client: RelayClient | null;
  snapshot: WorkspaceSnapshot | null;
  workspaces: WorkspaceSummary[];
  loading: boolean;
  error: string | null;
  recoveryWorkspace: WorkspaceSummary | null;
  refresh: () => Promise<void>;
  returnToPreviousWorkspace: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  createWorkspace: (command: CreateWorkspaceCommand) => Promise<void>;
  previewWorkspaceInvite: (
    workspaceId: string,
    secret: string,
  ) => Promise<WorkspaceInvite>;
  claimWorkspaceInvite: (
    workspaceId: string,
    secret: string,
  ) => Promise<WorkspaceInviteClaimResult>;
}

const RelaySessionContext = createContext<RelaySessionValue | null>(null);

export function RelaySessionProvider({ children }: { children: ReactNode }) {
  const { connectRelay, invalidateSession, sessionToken } = useAuth();
  const connectionGeneration = useRef(0);
  const connectionPromise = useRef<Promise<void> | null>(null);
  const [state, setState] = useState<{
    client: RelayClient | null;
    snapshot: WorkspaceSnapshot | null;
    workspaces: WorkspaceSummary[];
    loading: boolean;
    error: string | null;
  }>({
    client: null,
    snapshot: null,
    workspaces: knownWorkspaceSummaries(),
    loading: Boolean(sessionToken),
    error: null,
  });

  const connect = useCallback(() => {
    if (connectionPromise.current) return connectionPromise.current;
    const attempt = (async () => {
      const generation = ++connectionGeneration.current;
      let accountClient: RelayClient | null = null;
      if (!sessionToken) {
        relaySessionTransport.resetDeviceAuthorization();
        setRelayWorkspaceOverride(null);
        setState({
          client: null,
          snapshot: null,
          workspaces: [],
          loading: false,
          error: null,
        });
        return;
      }
      setState((current) => ({
        ...current,
        loading: !current.client,
        error: null,
      }));
      const watchdog = window.setTimeout(() => {
        if (generation !== connectionGeneration.current) return;
        connectionGeneration.current += 1;
        if (connectionPromise.current === attempt) {
          connectionPromise.current = null;
        }
        setState((current) => ({
          ...current,
          loading: false,
          error: "This relay is unavailable.",
        }));
      }, 12_000);
      try {
        // Keep an account-scoped client available even when the currently
        // selected workspace is down. Recovery must still be able to switch
        // to another workspace on this same relay.
        accountClient = new RelayClient({
          relayUrl: RELAY_URL,
          getAuthorization: relaySessionTransport.authorization,
          getDeviceAuthorization: relaySessionTransport.getDeviceAuthorization,
          fetch: relaySessionTransport.fetch,
        });
        let snapshot = await connectBoundRelayDevice(sessionToken);
        if (snapshot === undefined) {
          invalidateSession();
          return;
        }
        const pendingOrganizationInvitation =
          readPendingOrganizationInvitation();
        if (
          pendingOrganizationInvitation?.relayUrl === new URL(RELAY_URL).origin
        ) {
          const joined = await accountClient.joinOrganizationWorkspace(
            pendingOrganizationInvitation.workspaceId,
          );
          await accountClient.switchWorkspace(joined.workspaceId);
          clearPendingOrganizationInvitation();
          snapshot = await activeRelayWorkspace();
        }
        const pendingWorkspace = pendingWorkspaceSwitch();
        if (pendingWorkspace?.relayUrl === new URL(RELAY_URL).origin) {
          await accountClient.switchWorkspace(pendingWorkspace.workspaceId);
          snapshot = await activeRelayWorkspace();
        }
        const client = snapshot
          ? new RelayClient({
              relayUrl: RELAY_URL,
              workspaceId: snapshot.id,
              getAuthorization: relaySessionTransport.authorization,
              getDeviceAuthorization:
                relaySessionTransport.getDeviceAuthorization,
              fetch: relaySessionTransport.fetch,
            })
          : accountClient;
        const cellsStarted = snapshot
          ? ensureDesktopCells(snapshot, client)
          : Promise.resolve();
        const directoryWorkspaces = knownWorkspaceSummaries().map(
          (summary) => ({
            ...summary,
            isActive: summary.id === snapshot?.id,
          }),
        );
        if (generation !== connectionGeneration.current) return;
        setRelayWorkspaceOverride(snapshot?.id ?? null);
        if (snapshot) {
          rememberConnectedWorkspace({
            workspaceId: snapshot.id,
            relayUrl: new URL(RELAY_URL).origin,
          });
        }
        if (pendingWorkspace?.relayUrl === new URL(RELAY_URL).origin) {
          // Keep the previous workspace available until the target relay has
          // completed the entire connection. A partial switch must still have
          // a reliable Back path.
          clearWorkspaceSwitch();
        }
        setState({
          client,
          snapshot,
          workspaces: directoryWorkspaces,
          loading: false,
          error: null,
        });
        // The active workspace is enough to enter the app. Refreshing the
        // account-wide workspace directory is useful sidebar metadata, but it
        // must never turn a healthy workspace into a full-screen outage.
        void accountClient
          .listWorkspaces()
          .then((workspaces) => {
            rememberRelayWorkspaces(RELAY_URL, workspaces);
            if (generation !== connectionGeneration.current) return;
            setState((current) => ({
              ...current,
              workspaces: knownWorkspaceSummaries().map((summary) => ({
                ...summary,
                isActive: summary.id === current.snapshot?.id,
              })),
            }));
          })
          .catch((error: unknown) => {
            console.warn("[Relay] Workspace directory refresh failed:", error);
          });
        void cellsStarted.catch((error: unknown) => {
          console.error("[Relay] Desktop cells could not start:", error);
        });
      } catch (error) {
        if (generation !== connectionGeneration.current) return;
        setState((current) => ({
          ...current,
          client: accountClient ?? current.client,
          workspaces: knownWorkspaceSummaries(),
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        window.clearTimeout(watchdog);
      }
    })();
    connectionPromise.current = attempt;
    void attempt.finally(() => {
      if (connectionPromise.current === attempt)
        connectionPromise.current = null;
    });
    return attempt;
  }, [invalidateSession, sessionToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => void connect(), 0);
    return () => {
      window.clearTimeout(timer);
      setRelayWorkspaceOverride(null);
    };
  }, [connect]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void connect();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [connect]);

  const switchWorkspace = useCallback(
    async (workspaceId: string) => {
      if (state.client?.workspaceId === workspaceId) return;
      const workspaceRelay = relayForWorkspace(workspaceId);
      if (workspaceRelay && workspaceRelay !== new URL(RELAY_URL).origin) {
        const connection = resolveRelayConnection(
          workspaceRelay,
          knownRelayConnections(),
          {
            version: 1,
            relayUrl: new URL(CHIEF_CLOUD_RELAY_URL).origin,
            authBaseUrl: new URL(CHIEF_CLOUD_AUTH_BASE_URL).origin,
            authUiUrl: new URL(CHIEF_CLOUD_AUTH_UI_URL).origin,
          },
        );
        if (!connection) {
          throw new Error("This workspace's relay is no longer available.");
        }
        rememberWorkspaceSwitch({
          target: { workspaceId, relayUrl: workspaceRelay },
          ...(state.snapshot?.id
            ? {
                previous: {
                  workspaceId: state.snapshot.id,
                  relayUrl: new URL(RELAY_URL).origin,
                },
              }
            : undefined),
        });
        await connectRelay(connection);
        return;
      }
      if (!state.client) {
        throw new Error("This relay is not connected.");
      }
      rememberWorkspaceSwitch({
        target: {
          workspaceId,
          relayUrl: new URL(RELAY_URL).origin,
        },
        ...(state.snapshot?.id
          ? {
              previous: {
                workspaceId: state.snapshot.id,
                relayUrl: new URL(RELAY_URL).origin,
              },
            }
          : undefined),
      });
      connectionGeneration.current += 1;
      setRelayWorkspaceOverride(null);
      setState((current) => ({
        ...current,
        client: null,
        snapshot: null,
        loading: true,
        error: null,
      }));
      try {
        await state.client.switchWorkspace(workspaceId);
      } catch (error) {
        await connect();
        throw error;
      }
      await connect();
    },
    [connect, connectRelay, state.client, state.snapshot],
  );

  const recoveryWorkspace = useMemo(() => {
    return findRecoveryWorkspace(state.workspaces, new URL(RELAY_URL).origin);
  }, [state.workspaces]);

  const returnToPreviousWorkspace = useCallback(async () => {
    const pending = pendingWorkspaceSwitch();
    const previous = previousWorkspaceSwitch();
    if (
      previous &&
      (pending || previous.relayUrl !== new URL(RELAY_URL).origin)
    ) {
      const currentRelay = new URL(RELAY_URL).origin;
      if (previous.relayUrl === currentRelay) {
        if (!state.client) {
          throw new Error(
            "Chief could not reconnect to the previous workspace.",
          );
        }
        await state.client.switchWorkspace(previous.workspaceId);
        clearWorkspaceSwitch();
        await connect();
        return;
      }
      const connection = resolveRelayConnection(
        previous.relayUrl,
        knownRelayConnections(),
        {
          version: 1,
          relayUrl: new URL(CHIEF_CLOUD_RELAY_URL).origin,
          authBaseUrl: new URL(CHIEF_CLOUD_AUTH_BASE_URL).origin,
          authUiUrl: new URL(CHIEF_CLOUD_AUTH_UI_URL).origin,
        },
      );
      if (connection) {
        rememberWorkspaceSwitch({ target: previous });
        await connectRelay(connection);
        return;
      }
    }
    if (recoveryWorkspace) {
      await switchWorkspace(recoveryWorkspace.id);
      return;
    }
    clearWorkspaceSwitch();
    const chiefCloud = {
      version: 1 as const,
      relayUrl: new URL(CHIEF_CLOUD_RELAY_URL).origin,
      authBaseUrl: new URL(CHIEF_CLOUD_AUTH_BASE_URL).origin,
      authUiUrl: new URL(CHIEF_CLOUD_AUTH_UI_URL).origin,
    };
    if (new URL(RELAY_URL).origin !== chiefCloud.relayUrl) {
      await connectRelay(chiefCloud);
      return;
    }
    window.location.assign("/");
  }, [connect, connectRelay, recoveryWorkspace, state.client, switchWorkspace]);

  const createWorkspace = useCallback(
    async (command: CreateWorkspaceCommand) => {
      if (!state.client) throw new Error("The relay is not connected.");
      const snapshot = await state.client.createWorkspace(command);
      const workspace = state.client.forWorkspace(snapshot.id);
      await ensureDesktopCells(snapshot, workspace);
      await connect();
    },
    [connect, state.client],
  );

  const previewWorkspaceInvite = useCallback(
    async (workspaceId: string, secret: string) => {
      if (!state.client) throw new Error("The relay is not connected.");
      return state.client.previewWorkspaceInvite(workspaceId, secret);
    },
    [state.client],
  );

  const claimWorkspaceInvite = useCallback(
    async (workspaceId: string, secret: string) => {
      if (!state.client) throw new Error("The relay is not connected.");
      const result = await state.client.claimWorkspaceInvite(
        workspaceId,
        secret,
      );
      await connect();
      return result;
    },
    [connect, state.client],
  );

  const value = useMemo<RelaySessionValue>(
    () => ({
      ...state,
      recoveryWorkspace,
      refresh: connect,
      returnToPreviousWorkspace,
      switchWorkspace,
      createWorkspace,
      previewWorkspaceInvite,
      claimWorkspaceInvite,
    }),
    [
      claimWorkspaceInvite,
      connect,
      createWorkspace,
      previewWorkspaceInvite,
      recoveryWorkspace,
      returnToPreviousWorkspace,
      state,
      switchWorkspace,
    ],
  );
  return (
    <RelaySessionContext.Provider value={value}>
      {children}
    </RelaySessionContext.Provider>
  );
}

export function useRelaySession() {
  const value = useContext(RelaySessionContext);
  if (!value) {
    throw new Error("useRelaySession must be used inside RelaySessionProvider");
  }
  return value;
}
