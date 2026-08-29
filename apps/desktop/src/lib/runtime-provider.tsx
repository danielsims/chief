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
import { toast } from "sonner";

import type {
  AgentDefinition,
  BrowserRunRecord,
  IntegrationSetupProgress,
} from "@chief/agent-runtime/types";

import type { RuntimeBrowserSession } from "./browser-sessions";
import type { RuntimeContextValue, RuntimeStatus } from "./runtime-context";
import {
  anchorBrowserRun as anchorRuntimeBrowserRun,
  anchorBrowserSession as anchorRuntimeBrowserSession,
  beginBrowserActivity,
  completeBrowserActivity,
  completeBrowserSession,
  completeBrowserRun as completeRuntimeBrowserRun,
  hideBrowserCursor,
  mergeBrowserRunSnapshot,
  presentBrowserSession,
  updateBrowserSession,
  upsertBrowserSession,
  upsertBrowserRun as upsertRuntimeBrowserRun,
} from "./browser-sessions";
import { navigateApp, notifySystem } from "./notifications";
import { useRelayRuntimeTransport } from "./relay-runtime-transport";
import { useRelaySession } from "./relay-session";
import { useWorkspaceCapability } from "./workspace-capability";

/** Durable NIP-29 events for channel timelines and message search. */

const EMPTY_SETUP_PROGRESS: Readonly<Record<string, IntegrationSetupProgress>> =
  {};

export type { RuntimeStatus } from "./runtime-context";

const BROWSER_VIEWPORT = { width: 1280, height: 800 } as const;

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

export function RuntimeCoreProvider({ children }: { children: ReactNode }) {
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const relaySession = useRelaySession();
  const client = useRelayRuntimeTransport(relaySession);

  const [status, setStatus] = useState<RuntimeStatus>("connecting");
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [browserSessions, setBrowserSessions] = useState<
    Record<string, RuntimeBrowserSession>
  >({});
  const browserSessionsRef = useRef(browserSessions);
  useEffect(() => {
    browserSessionsRef.current = browserSessions;
  }, [browserSessions]);
  const [browserRuns, setBrowserRuns] = useState<BrowserRunRecord[]>([]);
  const browserCursorTimersRef = useRef(new Map<string, number>());
  const browserOwnersRef = useRef(
    new Map<
      string,
      {
        workspaceId: string;
        conversationId: string;
        threadRootId?: string;
      }
    >(),
  );
  const [setupProgressState, setSetupProgressState] = useState<{
    workspaceId: string;
    byConversation: Record<string, IntegrationSetupProgress>;
  } | null>(null);
  const integrationSetupProgress =
    setupProgressState?.workspaceId === cloudOrganizationId
      ? setupProgressState.byConversation
      : EMPTY_SETUP_PROGRESS;
  const completeBrowser = useCallback((runId: string) => {
    const timer = browserCursorTimersRef.current.get(runId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      browserCursorTimersRef.current.delete(runId);
    }
    browserOwnersRef.current.delete(runId);
    setBrowserSessions((current) => {
      return completeBrowserSession(current, runId);
    });
    setBrowserRuns((current) => [...completeRuntimeBrowserRun(current, runId)]);
  }, []);
  const openBrowser = useCallback(
    (
      url: string,
      conversationId?: string,
      options?: {
        browserRunId?: string;
        threadRootId?: string;
        anchorMessageId?: string;
      },
    ) => {
      if (!conversationId || !cloudOrganizationId) return;
      const runId = options?.browserRunId;
      const existing = runId ? browserSessions[runId] : undefined;
      const threadRootId =
        options?.threadRootId ?? existing?.threadRootId ?? null;
      const pending = {
        workspaceId: cloudOrganizationId,
        conversationId,
        ...(threadRootId ? { threadRootId } : undefined),
        url,
      };
      if (runId) {
        browserOwnersRef.current.set(runId, pending);
        setBrowserSessions((current) =>
          upsertBrowserSession(current, {
            runId,
            url,
            streamUrl: null,
            conversationId,
            parentConversationId: existing?.parentConversationId ?? null,
            workspaceId: cloudOrganizationId,
            threadRootId,
            anchorMessageId:
              options.anchorMessageId ??
              (existing?.runId === runId ? existing.anchorMessageId : null),
            status: "active",
            createdAt: existing?.createdAt ?? Date.now(),
            presentation: existing?.presentation ?? "inline",
            presentationRevision: existing?.presentationRevision ?? 0,
            operatingLabel: null,
            operating: false,
            agentCursor: null,
          }),
        );
      }
      client.send({
        type: "browserNavigateRequest",
        ...pending,
        ...(options?.browserRunId
          ? { browserRunId: options.browserRunId }
          : undefined),
        ...BROWSER_VIEWPORT,
      });
    },
    [browserSessions, client, cloudOrganizationId],
  );
  const reloadBrowser = useCallback(
    (runId: string) => {
      const session = browserSessions[runId];
      if (!session) return;
      client.send({
        type: "browserReload",
        workspaceId: session.workspaceId,
        conversationId: session.conversationId,
        browserRunId: runId,
      });
    },
    [browserSessions, client],
  );
  const reportBrowserUrl = useCallback(
    (runId: string, url: string) => {
      const session = browserSessions[runId];
      if (!session) return;
      setBrowserSessions((current) =>
        updateBrowserSession(current, runId, (value) => ({
          ...value,
          url,
        })),
      );
      client.send({
        type: "browserUrlChanged",
        workspaceId: session.workspaceId,
        conversationId: session.conversationId,
        browserRunId: runId,
        url,
      });
    },
    [browserSessions, client],
  );
  const closeBrowser = useCallback(
    (runId: string) => {
      const session = browserSessionsRef.current[runId];
      const owner = browserOwnersRef.current.get(runId);
      if (owner) {
        client.send({
          type: "browserClose",
          ...owner,
          browserRunId: runId,
        });
      } else if (session) {
        client.send({
          type: "browserClose",
          workspaceId: session.workspaceId,
          conversationId: session.conversationId,
          browserRunId: runId,
        });
      }
      completeBrowser(runId);
    },
    [client, completeBrowser],
  );
  const takeBrowserControl = useCallback(
    (runId: string) => {
      const session = browserSessions[runId];
      if (!session) return;
      const executorCapability =
        session.workspaceId === cloudOrganizationId ? capability : null;
      if (!executorCapability) return;
      client.send({
        type: "interruptChat",
        workspaceId: session.workspaceId,
        chatId: session.conversationId,
        executorCapability,
      });
    },
    [browserSessions, capability, client, cloudOrganizationId],
  );
  const anchorBrowserSession = useCallback(
    (runId: string, messageId: string) => {
      setBrowserSessions((current) =>
        anchorRuntimeBrowserSession(current, runId, messageId),
      );
      if (!cloudOrganizationId || !capability) return;
      setBrowserRuns((current) => [
        ...anchorRuntimeBrowserRun(current, runId, messageId),
      ]);
      client.send({
        type: "anchorBrowserRun",
        workspaceId: cloudOrganizationId,
        browserRunId: runId,
        messageId,
        executorCapability: capability,
      });
    },
    [capability, client, cloudOrganizationId],
  );

  useEffect(() => {
    const browserCursorTimers = browserCursorTimersRef.current;
    const browserOwners = browserOwnersRef.current;
    client.setStatusListener((s) => {
      setStatus(s);
      if (s === "connected") client.send({ type: "listAgents" });
    });
    const unsub = client.subscribe((msg) => {
      if (msg.type === "agents") setAgents(msg.agents);
      if (
        msg.type === "browserRuns" &&
        msg.workspaceId === cloudOrganizationId
      ) {
        setBrowserRuns((current) => mergeBrowserRunSnapshot(current, msg.runs));
      }
      if (
        (msg.type === "browserPrepare" || msg.type === "browserNavigate") &&
        msg.workspaceId === cloudOrganizationId
      ) {
        const owner = {
          workspaceId: msg.workspaceId,
          conversationId: msg.conversationId,
          ...(msg.threadRootId
            ? { threadRootId: msg.threadRootId }
            : undefined),
        };
        browserOwners.set(msg.browserRunId, owner);
        setBrowserSessions((current) => {
          const existing = current[msg.browserRunId];
          const createdAt = existing?.createdAt ?? Date.now();
          return upsertBrowserSession(current, {
            runId: msg.browserRunId,
            url: msg.url,
            streamUrl: msg.type === "browserNavigate" ? msg.streamUrl : null,
            conversationId: msg.conversationId,
            parentConversationId: msg.parentConversationId ?? null,
            workspaceId: msg.workspaceId,
            threadRootId: msg.threadRootId ?? null,
            anchorMessageId:
              existing?.status === "active" &&
              existing.runId === msg.browserRunId
                ? existing.anchorMessageId
                : (msg.anchorMessageId ?? null),
            status: "active",
            createdAt,
            presentation: existing?.presentation ?? "inline",
            presentationRevision: existing?.presentationRevision ?? 0,
            operatingLabel: existing?.operatingLabel ?? null,
            operating: existing?.operating ?? false,
            agentCursor: existing?.agentCursor ?? null,
          });
        });
        setBrowserRuns((current) => [
          ...upsertRuntimeBrowserRun(current, {
            id: msg.browserRunId,
            workspaceId: msg.workspaceId,
            conversationId: msg.conversationId,
            ...(msg.parentConversationId
              ? { parentConversationId: msg.parentConversationId }
              : undefined),
            ...(msg.threadRootId
              ? { threadRootId: msg.threadRootId }
              : undefined),
            ...(msg.anchorMessageId
              ? { anchorMessageId: msg.anchorMessageId }
              : undefined),
            url: msg.url,
            status: "active",
            createdAt:
              current.find((run) => run.id === msg.browserRunId)?.createdAt ??
              Date.now(),
            updatedAt: Date.now(),
          }),
        ]);
        // Browser activity is projected into its owning chat or thread. Do not
        // navigate here: changing the route remounts the conversation exactly
        // as the first stream frame arrives and can make the session appear to
        // disappear. Background browser work should not steal navigation.
      }
      if (
        msg.type === "browserActivity" &&
        msg.workspaceId === cloudOrganizationId &&
        browserOwners.get(msg.browserRunId)?.workspaceId === msg.workspaceId
      ) {
        const currentTimer = browserCursorTimers.get(msg.browserRunId);
        if (msg.cursor && currentTimer !== undefined) {
          window.clearTimeout(currentTimer);
          browserCursorTimers.delete(msg.browserRunId);
        }
        setBrowserSessions((current) => {
          const session = current[msg.browserRunId];
          if (!session) return current;
          return updateBrowserSession(current, msg.browserRunId, () =>
            msg.phase === "started"
              ? beginBrowserActivity(session, msg)
              : completeBrowserActivity(session, msg),
          );
        });
        if (msg.phase === "completed" && msg.cursor) {
          const hide = window.setTimeout(() => {
            setBrowserSessions((current) => {
              const session = current[msg.browserRunId];
              if (!session) return current;
              return updateBrowserSession(current, msg.browserRunId, () =>
                hideBrowserCursor(session),
              );
            });
            browserCursorTimers.delete(msg.browserRunId);
          }, 4_000);
          browserCursorTimers.set(msg.browserRunId, hide);
        }
      }
      if (
        msg.type === "browserPresentation" &&
        msg.workspaceId === cloudOrganizationId
      ) {
        setBrowserSessions((current) =>
          presentBrowserSession(current, msg.browserRunId, msg.mode),
        );
      }
      const browserOwner =
        msg.type === "browserClosed"
          ? browserOwners.get(msg.browserRunId)
          : undefined;
      if (
        msg.type === "browserClosed" &&
        msg.workspaceId === cloudOrganizationId &&
        msg.workspaceId === browserOwner?.workspaceId &&
        msg.conversationId === browserOwner.conversationId
      ) {
        completeBrowser(msg.browserRunId);
      }
      if (
        msg.type === "integrationSetupProgress" &&
        msg.workspaceId === cloudOrganizationId
      ) {
        setSetupProgressState((current) => ({
          workspaceId: msg.workspaceId,
          byConversation: {
            ...(current?.workspaceId === msg.workspaceId
              ? current.byConversation
              : undefined),
            [msg.conversationId]: msg.progress,
          },
        }));
      }
      if (
        msg.type === "integrationVerified" &&
        msg.workspaceId === cloudOrganizationId
      ) {
        for (const [runId, owner] of browserOwners) {
          if (owner.workspaceId === msg.workspaceId) {
            closeBrowser(runId);
          }
        }
      }
      if (
        msg.type === "runtimeNotice" &&
        msg.workspaceId === cloudOrganizationId
      ) {
        // Starting scheduled work is visible in Schedule and does not need a
        // banner. Terminal outcomes still notify because they may need review.
        if (msg.notice.kind === "work-started") return;
        const isScheduledWorkNotice = [
          "work-completed",
          "work-blocked",
          "work-failed",
        ].includes(msg.notice.kind);
        const route = isScheduledWorkNotice ? "/schedule" : "/";
        if (!isScheduledWorkNotice) {
          toast(msg.notice.title, {
            description: msg.notice.detail,
            duration: 10_000,
            action: {
              label: "Review action",
              onClick: () => navigateApp(route),
            },
          });
        }
        void notifySystem(msg.notice.title, msg.notice.detail, {
          kind: "route",
          route,
        });
      }
    });
    client.connect();
    return () => {
      unsub();
      client.destroy();
      for (const timer of browserCursorTimers.values()) {
        window.clearTimeout(timer);
      }
      browserCursorTimers.clear();
      browserOwners.clear();
    };
  }, [client, closeBrowser, cloudOrganizationId, completeBrowser]);

  useEffect(() => {
    if (status !== "connected" || !cloudOrganizationId || !capability) return;
    client.send({
      type: "listBrowserRuns",
      workspaceId: cloudOrganizationId,
      executorCapability: capability,
    });
  }, [capability, client, cloudOrganizationId, status]);

  const value = useMemo(
    () => ({
      client,
      status,
      agents,
      anchorBrowserSession,
      browserRuns,
      browserSessions,
      integrationSetupProgress,
      openBrowser,
      reportBrowserUrl,
      reloadBrowser,
      takeBrowserControl,
      closeBrowser,
    }),
    [
      agents,
      anchorBrowserSession,
      browserRuns,
      browserSessions,
      client,
      closeBrowser,
      integrationSetupProgress,
      openBrowser,
      reportBrowserUrl,
      reloadBrowser,
      status,
      takeBrowserControl,
    ],
  );
  return (
    <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
  );
}

export function useRuntime() {
  const ctx = useContext(RuntimeContext);
  if (!ctx) throw new Error("useRuntime must be used inside RuntimeProvider");
  return ctx;
}
