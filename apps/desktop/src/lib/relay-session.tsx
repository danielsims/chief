import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CreateWorkspaceCommand } from "@chief/relay-contracts";
import { RelayClient } from "@chief/relay-client";

import type { RelaySessionValue } from "./relay-session-value";
import { connectedRelayIdentities } from "./auth/account-directory";
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
  rememberRelayWorkspaces,
  resolveRelayConnection,
  workspaceForRelayIdentities,
} from "./relay-connection";
import {
  activeRelayWorkspace,
  connectBoundRelayDevice,
  relaySessionTransport,
} from "./relay-session-api";
import { RelaySessionContext } from "./relay-session-context";
import {
  initialRelaySessionState,
  visibleRelaySessionState,
} from "./relay-session-state";
import { setRelayWorkspaceOverride } from "./relay-workspace-override";
import {
  clearWorkspaceSwitch,
  findRecoveryWorkspace,
  pendingWorkspaceSwitch,
  previousWorkspaceSwitch,
  rememberConnectedWorkspace,
  rememberWorkspaceSwitch,
} from "./workspace-switch-state";

export function RelaySessionProvider({ children }: { children: ReactNode }) {
  const { connectRelay, invalidateSession, sessionToken, user } = useAuth();
  const accountId = user?.id ?? null;
  const connectionGeneration = useRef(0);
  const connectionPromise = useRef<Promise<void> | null>(null);
  const [state, setState] = useState(() =>
    initialRelaySessionState(accountId, sessionToken),
  );

  const connect = useCallback(() => {
    if (connectionPromise.current) return connectionPromise.current;
    const attempt = (async () => {
      const generation = ++connectionGeneration.current;
      let accountClient: RelayClient | null = null;
      if (!sessionToken) {
        relaySessionTransport.resetDeviceAuthorization();
        setRelayWorkspaceOverride(null);
        setState({
          accountId: null,
          client: null,
          snapshot: null,
          workspaces: [],
          loading: false,
          error: null,
        });
        return;
      }
      if (!accountId) return;
      setState((current) =>
        current.accountId === accountId
          ? { ...current, loading: !current.client }
          : {
              accountId,
              client: null,
              snapshot: null,
              workspaces: knownWorkspaceSummaries(RELAY_URL, accountId),
              loading: true,
              error: null,
            },
      );
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
        const pendingWorkspace = pendingWorkspaceSwitch(accountId);
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
        const directoryWorkspaces = knownWorkspaceSummaries(
          RELAY_URL,
          accountId,
        ).map((summary) => ({
          ...summary,
          isActive: summary.id === snapshot?.id,
        }));
        if (generation !== connectionGeneration.current) return;
        setRelayWorkspaceOverride(snapshot?.id ?? null);
        if (snapshot) {
          rememberConnectedWorkspace(accountId, {
            workspaceId: snapshot.id,
            relayUrl: new URL(RELAY_URL).origin,
          });
        }
        if (pendingWorkspace?.relayUrl === new URL(RELAY_URL).origin) {
          // Keep the previous workspace available until the target relay has
          // completed the entire connection. A partial switch must still have
          // a reliable Back path.
          clearWorkspaceSwitch(accountId);
        }
        setState({
          accountId,
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
            rememberRelayWorkspaces(RELAY_URL, accountId, workspaces);
            if (generation !== connectionGeneration.current) return;
            setState((current) => ({
              ...current,
              accountId,
              workspaces: knownWorkspaceSummaries(RELAY_URL, accountId).map(
                (summary) => ({
                  ...summary,
                  isActive: summary.id === current.snapshot?.id,
                }),
              ),
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
          accountId,
          client: accountClient ?? current.client,
          workspaces: knownWorkspaceSummaries(RELAY_URL, accountId),
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
  }, [accountId, invalidateSession, sessionToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => void connect(), 0);
    return () => {
      window.clearTimeout(timer);
      connectionGeneration.current += 1;
      connectionPromise.current = null;
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
    async (
      workspaceId: string,
      target?: { relayUrl: string; accountId: string },
    ) => {
      if (state.client?.workspaceId === workspaceId) return;
      if (!accountId) throw new Error("Sign in before switching workspaces.");
      const workspaceLocation = target
        ? { relayUrl: target.relayUrl, accountId: target.accountId }
        : workspaceForRelayIdentities(workspaceId, connectedRelayIdentities());
      const workspaceRelay = workspaceLocation?.relayUrl ?? null;
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
        rememberWorkspaceSwitch(accountId, {
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
      rememberWorkspaceSwitch(accountId, {
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
        accountId,
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
    [accountId, connect, connectRelay, state.client, state.snapshot],
  );

  const recoveryWorkspace = useMemo(() => {
    return findRecoveryWorkspace(
      accountId,
      state.workspaces,
      new URL(RELAY_URL).origin,
    );
  }, [accountId, state.workspaces]);

  const returnToPreviousWorkspace = useCallback(async () => {
    if (!accountId) return;
    const pending = pendingWorkspaceSwitch(accountId);
    const previous = previousWorkspaceSwitch(accountId);
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
        clearWorkspaceSwitch(accountId);
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
        rememberWorkspaceSwitch(accountId, { target: previous });
        await connectRelay(connection);
        return;
      }
    }
    if (recoveryWorkspace) {
      await switchWorkspace(recoveryWorkspace.id);
      return;
    }
    clearWorkspaceSwitch(accountId);
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
  }, [
    accountId,
    connect,
    connectRelay,
    recoveryWorkspace,
    state.client,
    switchWorkspace,
  ]);

  const createWorkspace = useCallback(
    async (command: CreateWorkspaceCommand, apiKey?: string) => {
      if (!state.client) throw new Error("The relay is not connected.");
      const snapshot = await state.client.createWorkspace(command);
      const workspace = state.client.forWorkspace(snapshot.id);
      const apiKeyValue = apiKey?.trim();
      if (apiKeyValue) {
        await workspace.setWorkspaceSecret("opencode", apiKeyValue);
      }
      await ensureDesktopCells(snapshot, workspace);
      // Reconnect the session to the new workspace, but never block the caller
      // while it settles. The app reconnects on mount anyway; a slow or failed
      // reconnect must not strand the user on the create screen.
      void connect().catch((error) =>
        console.error("[Workspace] Reconnect after create failed:", error),
      );
      return snapshot;
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

  const visibleState = useMemo(
    () => visibleRelaySessionState(state, accountId, sessionToken),
    [accountId, sessionToken, state],
  );

  const value = useMemo<RelaySessionValue>(
    () => ({
      ...visibleState,
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
      visibleState,
      switchWorkspace,
    ],
  );
  return (
    <RelaySessionContext.Provider value={value}>
      {children}
    </RelaySessionContext.Provider>
  );
}

export { useRelaySession } from "./relay-session-context";
