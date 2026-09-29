import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import type {
  GitHubConnection,
  GitHubRepository,
} from "@chief/relay-contracts";

import { useRelaySession } from "./relay-session-context";

const POLL_MS = 2_000;
const WAIT_LIMIT_MS = 10 * 60 * 1000;

export type GitHubConnectionState =
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | {
      status: "ready";
      connection: GitHubConnection;
      repositories: GitHubRepository[];
      /** Waiting for the person to finish on GitHub in their browser. */
      waiting: boolean;
    };

export function isGitHubConnected(connection: GitHubConnection) {
  return connection.installations.length > 0;
}

/**
 * The workspace's GitHub connection and the repositories it can reach. While
 * the person is on GitHub, it checks back until the new access shows up.
 */
export function useGitHubConnection() {
  const { client } = useRelaySession();
  const [state, setState] = useState<GitHubConnectionState>({
    status: "loading",
  });
  const waitStartedAt = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      const connection = await client.github.connection();
      const repositories = isGitHubConnected(connection)
        ? await client.github.repositories()
        : [];
      setState((current) => {
        const before =
          current.status === "ready"
            ? current.connection.installations.length
            : 0;
        const changed = connection.installations.length !== before;
        if (changed) waitStartedAt.current = null;
        return {
          status: "ready",
          connection,
          repositories,
          waiting: waitStartedAt.current !== null,
        };
      });
    } catch (error) {
      setState({
        status: "unavailable",
        message:
          error instanceof Error ? error.message : "GitHub isn't available.",
      });
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const waiting = state.status === "ready" && state.waiting;
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => {
      if (
        waitStartedAt.current !== null &&
        Date.now() - waitStartedAt.current > WAIT_LIMIT_MS
      ) {
        waitStartedAt.current = null;
      }
      void load();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, waiting]);

  const openInBrowser = useCallback(async (url: string) => {
    waitStartedAt.current = Date.now();
    setState((current) =>
      current.status === "ready" ? { ...current, waiting: true } : current,
    );
    await openUrl(url);
  }, []);

  const connect = useCallback(async () => {
    if (!client) return;
    await openInBrowser(await client.github.installUrl());
  }, [client, openInBrowser]);

  const setUp = useCallback(
    async (name: string) => {
      if (!client) return;
      await openInBrowser(await client.github.setupUrl(name));
    },
    [client, openInBrowser],
  );

  return { state, connect, setUp, reload: load };
}
