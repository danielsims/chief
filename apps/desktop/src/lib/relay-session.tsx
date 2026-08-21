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
import { invoke, isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

import type {
  CreateWorkspaceCommand,
  WorkspaceInvite,
  WorkspaceInviteClaimResult,
  WorkspaceSnapshot,
  WorkspaceSummary,
} from "@chief/relay-contracts";
import { RelayClient } from "@chief/relay-client";
import { workspaceSnapshotSchema } from "@chief/relay-contracts";

import { requestAccountAssertion } from "./auth/account-assertion";
import { useAuth } from "./auth/auth-context";
import { RELAY_URL } from "./config";
import { setRelayWorkspaceOverride } from "./relay-workspace-override";

interface RelaySessionValue {
  client: RelayClient | null;
  snapshot: WorkspaceSnapshot | null;
  workspaces: WorkspaceSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
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

async function authorization(input: {
  url: string;
  method: string;
  body: string;
}) {
  if (!isTauri()) {
    throw new Error("Relay device signing requires the Chief desktop app.");
  }
  return invoke<string>("relay_nip98_authorization", input);
}

const relayFetch: typeof fetch = (input, init) =>
  isTauri() ? tauriFetch(input, init) : fetch(input, init);

let deviceAuthorization: string | undefined;

async function signedFetch(url: URL, init: RequestInit = {}) {
  const method = init.method?.toUpperCase() ?? "GET";
  const body = typeof init.body === "string" ? init.body : "";
  const headers = new Headers(init.headers);
  headers.set(
    "authorization",
    await authorization({ url: url.toString(), method, body }),
  );
  if (deviceAuthorization) {
    headers.set("x-chief-device-authorization", deviceAuthorization);
  }
  return relayFetch(url, { ...init, headers });
}

async function bindAccount(accountToken: string) {
  const url = new URL("/v1/identity/device", RELAY_URL);
  const body = JSON.stringify({ accountToken });
  const response = await signedFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (!response.ok) throw await relayResponseError(response);
  const binding = (await response.json()) as {
    deviceAuthorization?: unknown;
  };
  if (
    typeof binding.deviceAuthorization !== "string" ||
    binding.deviceAuthorization.length < 32
  ) {
    throw new Error("The relay returned an invalid device authorization.");
  }
  deviceAuthorization = binding.deviceAuthorization;
}

async function activeWorkspace() {
  const response = await signedFetch(new URL("/v1/me/workspace", RELAY_URL));
  if (response.status === 204) return null;
  if (!response.ok) throw await relayResponseError(response);
  return workspaceSnapshotSchema.parse(await response.json());
}

class RelaySessionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

function relayResponseError(response: Response): Promise<RelaySessionError> {
  return response
    .json()
    .catch(() => null)
    .then((value: unknown) => {
      const body = value as {
        error?: { code?: string; message?: string };
      } | null;
      return new RelaySessionError(
        body?.error?.message ?? `Relay request failed (${response.status}).`,
        response.status,
        body?.error?.code,
      );
    });
}

async function connectBoundDevice(sessionToken: string) {
  try {
    return await activeWorkspace();
  } catch (error) {
    if (!(error instanceof RelaySessionError) || error.status !== 401) {
      throw error;
    }
  }
  const accountAssertion = await requestAccountAssertion(sessionToken);
  if (!accountAssertion) return undefined;
  await bindAccount(accountAssertion);
  return activeWorkspace();
}

export function RelaySessionProvider({ children }: { children: ReactNode }) {
  const { invalidateSession, sessionToken } = useAuth();
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
    workspaces: [],
    loading: Boolean(sessionToken),
    error: null,
  });

  const connect = useCallback(() => {
    if (connectionPromise.current) return connectionPromise.current;
    const attempt = (async () => {
      const generation = ++connectionGeneration.current;
      if (!sessionToken) {
        deviceAuthorization = undefined;
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
      setState((current) => ({ ...current, loading: true, error: null }));
      try {
        const snapshot = await connectBoundDevice(sessionToken);
        if (snapshot === undefined) {
          invalidateSession();
          return;
        }
        const accountClient = new RelayClient({
          relayUrl: RELAY_URL,
          getAuthorization: authorization,
          getDeviceAuthorization: () => deviceAuthorization,
          fetch: relayFetch,
        });
        const client = snapshot
          ? new RelayClient({
              relayUrl: RELAY_URL,
              workspaceId: snapshot.id,
              getAuthorization: authorization,
              getDeviceAuthorization: () => deviceAuthorization,
              fetch: relayFetch,
            })
          : accountClient;
        const workspaces = await accountClient.listWorkspaces();
        if (generation !== connectionGeneration.current) return;
        setRelayWorkspaceOverride(snapshot?.id ?? null);
        setState({ client, snapshot, workspaces, loading: false, error: null });
      } catch (error) {
        if (generation !== connectionGeneration.current) return;
        // A focus refresh is opportunistic. Preserve the last usable relay
        // session so a temporary account-token outage never ejects someone
        // from their workspace or erases the directory they were viewing.
        setState((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
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
      if (!state.client || state.client.workspaceId === workspaceId) return;
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
    [connect, state.client],
  );

  const createWorkspace = useCallback(
    async (command: CreateWorkspaceCommand) => {
      if (!state.client) throw new Error("The relay is not connected.");
      await state.client.createWorkspace(command);
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
      refresh: connect,
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
