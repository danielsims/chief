import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  CreateWorkspaceCommand,
  WorkspaceSummary,
} from "@chief/relay-contracts";
import { RelayClient } from "@chief/relay-client";

import type { RelayConnectionIntent } from "./relay-session-state";
import type { RelaySessionValue } from "./relay-session-value";
import { connectedRelayIdentities } from "./auth/account-directory";
import { useAuth } from "./auth/auth-context";
import { RELAY_URL } from "./config";
import { ensureDesktopCells } from "./desktop-cell-runtime";
import {
  clearPendingOrganizationInvitation,
  readPendingOrganizationInvitation,
} from "./organization-invitation";
import {
  knownRelayConnections,
  knownWorkspacesForRelayIdentities,
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
  beginRelayConnection,
  beginWorkspaceTransition,
  chiefCloudRelayConnection,
  directoryWorkspacesForSnapshot,
  failRelayConnection,
  initialRelaySessionState,
  visibleRelaySessionState,
  workspacesAfterCreate,
  workspaceSwitchMemory,
} from "./relay-session-state";
import { setRelayWorkspaceOverride } from "./relay-workspace-override";
import { hasActiveWorkspaceCreateSession } from "./workspace-entry";
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
  const lastBackgroundRefreshAt = useRef(0);
  const [state, setState] = useState(() =>
    initialRelaySessionState(accountId, sessionToken),
  );

  const connect = useCallback(
    (intent: RelayConnectionIntent = "foreground") => {
      if (connectionPromise.current) return connectionPromise.current;
      const attempt = (async () => {
        const generation = ++connectionGeneration.current;
        let accountClient: RelayClient | null = null;
        let refreshedWorkspaces: WorkspaceSummary[] | null = null;
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
        setState((current) => beginRelayConnection(current, accountId, intent));
        const watchdog = window.setTimeout(() => {
          if (generation !== connectionGeneration.current) return;
          connectionGeneration.current += 1;
          if (connectionPromise.current === attempt) {
            connectionPromise.current = null;
          }
          setState((current) =>
            failRelayConnection(
              current,
              accountId,
              "This relay is unavailable.",
              intent,
            ),
          );
        }, 12_000);
        try {
          // Keep an account-scoped client available even when the currently
          // selected workspace is down. Recovery must still be able to switch
          // to another workspace on this same relay.
          accountClient = new RelayClient({
            relayUrl: RELAY_URL,
            getAuthorization: relaySessionTransport.authorization,
            getDeviceAuthorization:
              relaySessionTransport.getDeviceAuthorization,
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
            pendingOrganizationInvitation?.relayUrl ===
            new URL(RELAY_URL).origin
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
          if (!snapshot) {
            // Resolve the directory before treating a missing selection as empty.
            refreshedWorkspaces = await accountClient.listWorkspaces();
            rememberRelayWorkspaces(RELAY_URL, accountId, refreshedWorkspaces);
            const [fallbackWorkspace] = refreshedWorkspaces;
            if (fallbackWorkspace) {
              await accountClient.switchWorkspace(fallbackWorkspace.id);
              snapshot = await activeRelayWorkspace();
            }
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
          const directoryWorkspaces = directoryWorkspacesForSnapshot(
            accountId,
            snapshot?.id,
          );
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
          // Directory metadata must not turn a healthy workspace into an outage.
          if (!refreshedWorkspaces) {
            void accountClient
              .listWorkspaces()
              .then((workspaces) => {
                rememberRelayWorkspaces(RELAY_URL, accountId, workspaces);
                if (generation !== connectionGeneration.current) return;
                setState((current) => ({
                  ...current,
                  accountId,
                  workspaces: directoryWorkspacesForSnapshot(
                    accountId,
                    current.snapshot?.id,
                  ),
                }));
              })
              .catch((error: unknown) => {
                console.warn(
                  "[Relay] Workspace directory refresh failed:",
                  error,
                );
              });
          }
          void cellsStarted.catch((error: unknown) => {
            console.error("[Relay] Desktop cells could not start:", error);
          });
        } catch (error) {
          if (generation !== connectionGeneration.current) return;
          if (intent === "background") {
            console.warn("[Relay] Background refresh failed:", error);
          }
          setState((current) => {
            const next = failRelayConnection(
              current,
              accountId,
              error instanceof Error ? error.message : String(error),
              intent,
            );
            if (next === current) return current;
            return {
              ...next,
              client: accountClient ?? current.client,
              workspaces: knownWorkspaceSummaries(RELAY_URL, accountId),
            };
          });
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
    },
    [accountId, invalidateSession, sessionToken],
  );

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
      if (document.visibilityState !== "visible") return;
      if (hasActiveWorkspaceCreateSession(window.sessionStorage)) return;
      const now = Date.now();
      if (now - lastBackgroundRefreshAt.current < 5_000) return;
      lastBackgroundRefreshAt.current = now;
      void connect("background");
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
      if (
        workspaceLocation &&
        workspaceRelay &&
        workspaceRelay !== new URL(RELAY_URL).origin
      ) {
        const connection = resolveRelayConnection(
          workspaceRelay,
          knownRelayConnections(),
          chiefCloudRelayConnection(),
        );
        if (!connection) {
          throw new Error("This workspace's relay is no longer available.");
        }
        rememberWorkspaceSwitch(
          workspaceLocation.accountId,
          workspaceSwitchMemory({
            workspaceId,
            targetRelayUrl: workspaceRelay,
            previousWorkspaceId: state.snapshot?.id,
            previousRelayUrl: new URL(RELAY_URL).origin,
          }),
        );
        await connectRelay(connection);
        return;
      }
      if (!state.client) {
        throw new Error("This relay is not connected.");
      }
      rememberWorkspaceSwitch(
        accountId,
        workspaceSwitchMemory({
          workspaceId,
          targetRelayUrl: new URL(RELAY_URL).origin,
          previousWorkspaceId: state.snapshot?.id,
          previousRelayUrl: new URL(RELAY_URL).origin,
        }),
      );
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
        chiefCloudRelayConnection(),
      );
      if (connection) {
        const previousLocation = workspaceForRelayIdentities(
          previous.workspaceId,
          connectedRelayIdentities(),
        );
        rememberWorkspaceSwitch(previousLocation?.accountId ?? accountId, {
          target: previous,
        });
        await connectRelay(connection);
        return;
      }
    }
    if (recoveryWorkspace) {
      await switchWorkspace(recoveryWorkspace.id);
      return;
    }
    clearWorkspaceSwitch(accountId);
    const chiefCloud = chiefCloudRelayConnection();
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

  const deleteWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!state.client) throw new Error("The relay is not connected.");
      if (!accountId) throw new Error("Sign in before deleting a workspace.");

      connectionGeneration.current += 1;
      connectionPromise.current = null;
      setState(beginWorkspaceTransition);
      let deleted = false;
      try {
        await state.client.deleteWorkspace(workspaceId);
        deleted = true;

        const remainingOnRelay = await state.client.listWorkspaces();
        rememberRelayWorkspaces(RELAY_URL, accountId, remainingOnRelay);
        const [nextOnRelay] = remainingOnRelay;
        if (nextOnRelay) {
          await state.client.switchWorkspace(nextOnRelay.id);
          await connect();
          return;
        }

        const fallback = knownWorkspacesForRelayIdentities(
          connectedRelayIdentities(),
        ).find(
          (workspace) =>
            workspace.summary.id !== workspaceId ||
            workspace.relayUrl !== new URL(RELAY_URL).origin,
        );
        if (fallback) {
          await switchWorkspace(fallback.summary.id, fallback);
          return;
        }
        await connect();
      } catch (error) {
        if (deleted) {
          await connect().catch(() => undefined);
        } else {
          setState({ ...state, loading: false, error: null });
        }
        throw error;
      }
    },
    [accountId, connect, state, switchWorkspace],
  );

  const createWorkspace = useCallback(
    async (
      command: CreateWorkspaceCommand,
      apiKey: string,
      options?: { reconnect?: boolean },
    ) => {
      if (!state.client) throw new Error("The relay is not connected.");
      if (!accountId) throw new Error("Sign in before creating a workspace.");
      const apiKeyValue = apiKey.trim();
      if (command.agentRuntime === "relay-cell" && !apiKeyValue) {
        throw new Error(
          command.inferenceProvider === "vercelAiGateway"
            ? "Enter a Vercel AI Gateway API key before creating a workspace."
            : "Enter an OpenCode API key before creating a workspace.",
        );
      }
      const snapshot = await state.client.createWorkspace(command, apiKeyValue);
      const workspace = state.client.forWorkspace(snapshot.id);
      if (command.agentRuntime === "relay-cell") {
        await ensureDesktopCells(snapshot, workspace);
      }

      const nextWorkspaces = workspacesAfterCreate(snapshot, state.workspaces);
      rememberRelayWorkspaces(RELAY_URL, accountId, nextWorkspaces);
      if (options?.reconnect === false) return snapshot;
      connectionGeneration.current += 1;
      connectionPromise.current = null;
      await connect("background");
      return snapshot;
    },
    [accountId, connect, state],
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
      deleteWorkspace,
      switchWorkspace,
      createWorkspace,
      previewWorkspaceInvite,
      claimWorkspaceInvite,
    }),
    [
      claimWorkspaceInvite,
      connect,
      createWorkspace,
      deleteWorkspace,
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
