/* eslint-disable max-lines */

import type { ChatTransport } from "ai";
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
import { useChat } from "@ai-sdk/react";
import { useAction, useConvexAuth, useMutation } from "convex/react";
import { toast } from "sonner";

import type {
  AgentDefinition,
  AgentEvent,
  AgentQuestion,
  BrowserRunRecord,
  CampaignRecord,
  ChatExecutionSelection,
  ChiefUIMessage,
  ClientMessage,
  ContentBlock,
  DiagnosticEventRecord,
  DriverType,
  ExecutorCapability,
  InputRequest,
  IntegrationSetupProgress,
  MessageAttachment,
  OnboardingSchedule,
  OnboardingWorkJob,
  ProviderModelOption,
  RecurringWorkRecord,
  ServerMessage,
  SessionRecord,
} from "@chief/agent-runtime/types";
import { api } from "@chief/backend/convex/_generated/api";

import type {
  RuntimeBrowserRuns,
  RuntimeBrowserSession,
  RuntimeBrowserSessions,
} from "./browser-sessions";
import type { ChannelReactionSummary } from "./channel-reactions";
import type { ScopedWorkspaceCapability } from "./workspace-capability";
import type { WorkspaceDataState } from "./workspace-data";
import { useAuth } from "./auth/auth-context";
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
import {
  applyOptimisticChannelReaction,
  foldChannelReactions,
} from "./channel-reactions";
import { navigateApp, notifySystem } from "./notifications";
import {
  clearPendingOnboardingWorkWhenPersisted,
  mergePendingOnboardingSchedules,
  pendingOnboardingSchedules,
  pendingOnboardingWorkStorageKey,
  readPendingOnboardingWork,
} from "./pending-onboarding-work";
import {
  readCachedProviderModels,
  retainUsefulProviderModels,
  writeCachedProviderModels,
} from "./provider-model-cache";
/** Durable NIP-29 events for channel timelines and message search. */
import { reactionIntentKey, useChannelEvents } from "./runtime-channels";
import {
  deduplicateDocumentParts,
  dropReplayedMessages,
  mergeRuntimeHistory,
  mergeRuntimeMessage,
  projectChannelTimeline,
  visibleRuntimeError,
} from "./runtime-messages";
import { useManualMissionHeartbeat } from "./runtime-mission-heartbeat";
import { useRecurringWorkSettings } from "./runtime-recurring-work";
import { useWaysOfWorkingSaver } from "./runtime-ways-of-working";
import { capabilityForWorkspace } from "./workspace-capability";
import { buildWorkspaceContext } from "./workspace-context";
import { emptyWorkspaceData, normalizeWorkspaceData } from "./workspace-data";

// "localhost" (not 127.0.0.1) — macOS ATS only exempts the literal
// localhost hostname for insecure websockets inside WKWebView.
const RUNTIME_URL = "ws://localhost:4318";
const EXECUTOR_CAPABILITY_PREFIX = "chief:executor-capability:";
const workspaceCapabilityCache = new Map<string, ExecutorCapability>();
const workspaceCapabilityRegistrations = new Map<
  string,
  Promise<ExecutorCapability>
>();
const EMPTY_SETUP_PROGRESS: Readonly<Record<string, IntegrationSetupProgress>> =
  {};

function workspaceCapabilityToken(organizationId: string): string {
  const key = `${EXECUTOR_CAPABILITY_PREFIX}${organizationId}`;
  const existing = window.localStorage.getItem(key);
  if (existing && /^[A-Za-z0-9_-]{43,128}$/.test(existing)) return existing;

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  window.localStorage.setItem(key, token);
  return token;
}

export function useWorkspaceCapability() {
  const { cloudOrganizationId } = useAuth();
  const { isAuthenticated } = useConvexAuth();
  const registerCapability = useAction(api.agentTools.registerCapability);
  const [scopedCapability, setScopedCapability] =
    useState<ScopedWorkspaceCapability | null>(() => {
      const cached = cloudOrganizationId
        ? workspaceCapabilityCache.get(cloudOrganizationId)
        : undefined;
      return cloudOrganizationId && cached
        ? { workspaceId: cloudOrganizationId, capability: cached }
        : null;
    });
  const [error, setError] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);

  useEffect(() => {
    if (!cloudOrganizationId || !isAuthenticated) {
      setScopedCapability(null);
      setError(null);
      return;
    }
    const cached = workspaceCapabilityCache.get(cloudOrganizationId);
    if (cached) {
      setScopedCapability({
        workspaceId: cloudOrganizationId,
        capability: cached,
      });
      setError(null);
    } else {
      setScopedCapability(null);
      setError(null);
    }

    let cancelled = false;
    let retryTimer: number | undefined;
    const token = workspaceCapabilityToken(cloudOrganizationId);
    let registration =
      workspaceCapabilityRegistrations.get(cloudOrganizationId);
    if (!registration) {
      registration = registerCapability({ token }).then(({ apiBaseUrl }) => ({
        apiBaseUrl,
        token,
      }));
      workspaceCapabilityRegistrations.set(cloudOrganizationId, registration);
      void registration
        .finally(() => {
          if (
            workspaceCapabilityRegistrations.get(cloudOrganizationId) ===
            registration
          ) {
            workspaceCapabilityRegistrations.delete(cloudOrganizationId);
          }
        })
        .catch(() => undefined);
    }
    void registration
      .then((next) => {
        if (cancelled) return;
        workspaceCapabilityCache.set(cloudOrganizationId, next);
        setScopedCapability({
          workspaceId: cloudOrganizationId,
          capability: next,
        });
        setRetryAttempt(0);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not authorize this workspace.",
          );
          retryTimer = window.setTimeout(
            () => setRetryAttempt((attempt) => attempt + 1),
            Math.min(30_000, 2_000 * 2 ** Math.min(retryAttempt, 4)),
          );
        }
      });
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [cloudOrganizationId, isAuthenticated, registerCapability, retryAttempt]);

  return {
    cloudOrganizationId,
    capability: capabilityForWorkspace(cloudOrganizationId, scopedCapability),
    error,
  };
}

type Listener = (msg: ServerMessage) => void;

export class RuntimeClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private queue: ClientMessage[] = [];
  private closed = false;
  private reconnectTimer: number | null = null;
  private connectTimer: number | null = null;
  private reconnectDelayMs = 1000;
  private statusListener: (status: RuntimeStatus) => void = () => {};

  setStatusListener(listener: (status: RuntimeStatus) => void) {
    this.statusListener = listener;
  }

  connect() {
    if (
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closed = false;
    try {
      const socket = new WebSocket(RUNTIME_URL);
      this.ws = socket;
      this.connectTimer = window.setTimeout(() => {
        if (this.ws === socket && socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      }, 8_000);
    } catch {
      this.ws = null;
      this.scheduleReconnect();
      return;
    }
    const socket = this.ws;
    socket.onopen = () => {
      this.clearConnectTimer();
      this.reconnectDelayMs = 1000;
      this.statusListener("connected");
      for (const msg of this.queue.splice(0)) this.send(msg);
    };
    socket.onmessage = (e) => {
      try {
        if (typeof e.data !== "string") return;
        const msg = JSON.parse(e.data) as ServerMessage;
        for (const l of this.listeners) l(msg);
      } catch {
        // ignore
      }
    };
    socket.onclose = () => {
      this.clearConnectTimer();
      if (this.ws === socket) this.ws = null;
      if (this.closed) return;
      this.scheduleReconnect();
    };
    socket.onerror = () => socket.close();
  }

  reconnectNow() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearConnectTimer();
    const socket = this.ws;
    this.ws = null;
    socket?.close();
    this.connect();
  }

  private clearConnectTimer() {
    if (this.connectTimer === null) return;
    window.clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private scheduleReconnect() {
    if (this.closed || this.reconnectTimer !== null) return;
    this.statusListener("disconnected");
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 5000);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
    }
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy() {
    this.closed = true;
    this.clearConnectTimer();
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}

export type RuntimeStatus = "connecting" | "connected" | "disconnected";

const BROWSER_VIEWPORT = { width: 1280, height: 800 } as const;

interface RuntimeContextValue {
  client: RuntimeClient;
  status: RuntimeStatus;
  agents: AgentDefinition[];
  browserSessions: RuntimeBrowserSessions;
  browserRuns: RuntimeBrowserRuns;
  anchorBrowserSession: (browserRunId: string, messageId: string) => void;
  integrationSetupProgress: Readonly<Record<string, IntegrationSetupProgress>>;
  openBrowser: (
    url: string,
    conversationId?: string,
    options?: {
      browserRunId?: string;
      threadRootId?: string;
      anchorMessageId?: string;
    },
  ) => void;
  reportBrowserUrl: (browserRunId: string, url: string) => void;
  reloadBrowser: (browserRunId: string) => void;
  takeBrowserControl: (browserRunId: string) => void;
  closeBrowser: (browserRunId: string) => void;
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const markIntegrationConnected = useMutation(api.integrations.markConnected);
  const [client] = useState(() => new RuntimeClient());

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
        ...(threadRootId ? { threadRootId } : {}),
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
          : {}),
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
      const executorCapability = workspaceCapabilityCache.get(
        session.workspaceId,
      );
      if (!executorCapability) return;
      client.send({
        type: "interruptChat",
        workspaceId: session.workspaceId,
        chatId: session.conversationId,
        executorCapability,
      });
    },
    [browserSessions, client],
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
          ...(msg.threadRootId ? { threadRootId: msg.threadRootId } : {}),
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
              : {}),
            ...(msg.threadRootId ? { threadRootId: msg.threadRootId } : {}),
            ...(msg.anchorMessageId
              ? { anchorMessageId: msg.anchorMessageId }
              : {}),
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
              : {}),
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
        void markIntegrationConnected({
          provider: msg.provider,
          category: msg.category,
          displayName: msg.displayName,
          externalId: msg.externalId,
        }).catch((error: unknown) =>
          toast.error(
            error instanceof Error
              ? error.message
              : "Chief could not save the verified integration.",
          ),
        );
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
  }, [
    client,
    closeBrowser,
    cloudOrganizationId,
    completeBrowser,
    markIntegrationConnected,
  ]);

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
    <RuntimeContext.Provider value={value}>
      <WorkspaceDataProvider>{children}</WorkspaceDataProvider>
    </RuntimeContext.Provider>
  );
}

export function useRuntime() {
  const ctx = useContext(RuntimeContext);
  if (!ctx) throw new Error("useRuntime must be used inside RuntimeProvider");
  return ctx;
}

export interface LocalChatSummary {
  id: string;
  agent: string;
  title: string;
  lastText: string;
  lastAt: number;
  driver?: DriverType;
  model?: string;
  running: boolean;
}

// Last-known workspace state, kept across component mounts so re-entering a
// page renders the previous data immediately and revalidates in place
// instead of flashing an empty frame.
const chatsCache = new Map<string, LocalChatSummary[]>();

/** Durable chats from the runtime-owned local libSQL database. */
export function useLocalChats(workspaceId: string | null) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [chats, setChats] = useState<LocalChatSummary[]>(() =>
    workspaceId ? (chatsCache.get(workspaceId) ?? []) : [],
  );
  const [resolved, setResolved] = useState(() =>
    Boolean(workspaceId && chatsCache.has(workspaceId)),
  );
  const chatsWorkspaceRef = useRef<string | null>(workspaceId);

  useEffect(() => {
    // Reset only when the workspace itself changes; a runtime reconnect or
    // capability refresh keeps the last list mounted while it revalidates.
    if (chatsWorkspaceRef.current !== workspaceId) {
      chatsWorkspaceRef.current = workspaceId;
      setChats(workspaceId ? (chatsCache.get(workspaceId) ?? []) : []);
      setResolved(Boolean(workspaceId && chatsCache.has(workspaceId)));
    }
    if (
      !workspaceId ||
      workspaceId !== cloudOrganizationId ||
      !capability ||
      status !== "connected"
    ) {
      return;
    }
    const unsubscribe = client.subscribe((message) => {
      if (message.type === "chats" && message.workspaceId === workspaceId) {
        chatsCache.set(workspaceId, message.chats);
        setChats(message.chats);
        setResolved(true);
      }
    });
    client.send({
      type: "listChats",
      workspaceId,
      executorCapability: capability,
    });
    return () => {
      unsubscribe();
    };
  }, [capability, client, cloudOrganizationId, status, workspaceId]);

  const remove = (chatId: string) => {
    if (!workspaceId || workspaceId !== cloudOrganizationId || !capability) {
      return;
    }
    setChats((current) => {
      const next = current.filter((chat) => chat.id !== chatId);
      chatsCache.set(workspaceId, next);
      return next;
    });
    client.send({
      type: "deleteChat",
      chatId,
      workspaceId,
      executorCapability: capability,
    });
  };

  return { chats, loading: !resolved, remove };
}

/**
 * Last-known transcripts keyed by `workspaceId:chatId`. Retained across chat
 * switches so returning to a channel renders its content immediately instead of
 * flashing an empty frame while history reloads; the server snapshot replaces
 * it moments later.
 */
const chatTranscriptCache = new Map<string, ChiefUIMessage[]>();

export { useChannelEvents, useWorkspaceChannels } from "./runtime-channels";

/** Durable NIP-25 reactions folded onto the local IDs used by chat messages. */
export function useChannelReactions(channelId: string | null) {
  const { events } = useChannelEvents(channelId);
  const { client } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [optimistic, setOptimistic] = useState<
    ReadonlyMap<
      string,
      { messageId: string; emoji: string; reacted: boolean; token: string }
    >
  >(new Map());

  const durableReactions = useMemo(
    () => foldChannelReactions(events),
    [events],
  );

  const reactions = useMemo(() => {
    let next: ReadonlyMap<string, readonly ChannelReactionSummary[]> =
      durableReactions;
    for (const intent of optimistic.values()) {
      const durable = durableReactions
        .get(intent.messageId)
        ?.find((reaction) => reaction.emoji === intent.emoji);
      if (Boolean(durable?.reacted) === intent.reacted) continue;
      next = applyOptimisticChannelReaction(
        next,
        intent.messageId,
        intent.emoji,
        intent.reacted,
      );
    }
    return next;
  }, [durableReactions, optimistic]);

  const toggleReaction = useCallback(
    (messageId: string, reaction: string) => {
      if (!cloudOrganizationId || !channelId || !capability) return;
      const current = reactions
        .get(messageId)
        ?.find((item) => item.emoji === reaction);
      const reacted = !current?.reacted;
      const key = reactionIntentKey(messageId, reaction);
      const token = crypto.randomUUID();
      setOptimistic((previous) =>
        new Map(previous).set(key, {
          messageId,
          emoji: reaction,
          reacted,
          token,
        }),
      );
      client.send({
        type: "reactToChannelMessage",
        workspaceId: cloudOrganizationId,
        channelId,
        messageId,
        reaction,
        executorCapability: capability,
      });

      window.setTimeout(() => {
        setOptimistic((previous) => {
          if (previous.get(key)?.token !== token) return previous;
          const next = new Map(previous);
          next.delete(key);
          return next;
        });
      }, 5_000);
    },
    [capability, channelId, client, cloudOrganizationId, reactions],
  );

  return { reactions, toggleReaction };
}

const providerModelsCache = new Map<DriverType, ProviderModelOption[]>();

function cachedProviderModels(driver: DriverType) {
  const memory = providerModelsCache.get(driver);
  if (memory) return memory;
  const stored = readCachedProviderModels(driver);
  if (stored.length > 0) providerModelsCache.set(driver, stored);
  return stored;
}

export function useProviderModels(driver: DriverType | null) {
  const { client, status } = useRuntime();
  // Cached across mounts and runtime reconnects: the picker renders the last
  // known list immediately and refreshes in place.
  const [models, setModels] = useState<ProviderModelOption[]>(() =>
    driver ? cachedProviderModels(driver) : [],
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const cached = driver ? cachedProviderModels(driver) : [];
    setModels(cached);
    if (!driver) return;
    if (cached.length === 0) setLoading(true);
    const unsubscribe = client.subscribe((message) => {
      if (message.type === "models" && message.driver === driver) {
        const next = retainUsefulProviderModels(cached, message.models);
        providerModelsCache.set(driver, next);
        writeCachedProviderModels(driver, next);
        setModels(next);
        setLoading(false);
      }
    });
    // RuntimeClient queues this request while its socket reconnects. Keeping
    // the subscription alive lets onboarding retain the last useful list and
    // refresh it as soon as the bundled runtime is ready.
    client.send({ type: "listModels", driver });
    return () => {
      unsubscribe();
    };
  }, [client, driver, status]);

  return { models, loading };
}

const workspaceDataCache = new Map<string, WorkspaceDataState>();

export function updatePendingOnboardingDriver(
  workspaceId: string,
  driver: DriverType,
  model: string | null,
) {
  const stored = readPendingOnboardingWork(workspaceId);
  if (!stored) return false;
  try {
    const pending = JSON.parse(stored) as Record<string, unknown>;
    window.localStorage.setItem(
      pendingOnboardingWorkStorageKey(workspaceId),
      JSON.stringify({ ...pending, driver, model }),
    );
    return true;
  } catch {
    return false;
  }
}

function useWorkspaceDataSource(workspaceId: string | null) {
  const { client, status } = useRuntime();
  const { sessionToken } = useAuth();
  const {
    cloudOrganizationId,
    capability,
    error: capabilityError,
  } = useWorkspaceCapability();
  // Loading means "no data has ever resolved for this workspace". The cache
  // spans mounts, so navigating back to a page shows the last data at once
  // and revalidates in place instead of flashing empty or placeholder frames.
  const [data, setData] = useState<WorkspaceDataState>(() =>
    workspaceId
      ? mergePendingOnboardingSchedules(
          workspaceId,
          workspaceDataCache.get(workspaceId) ?? emptyWorkspaceData,
        )
      : emptyWorkspaceData,
  );
  const [loading, setLoading] = useState(
    () => !(workspaceId && workspaceDataCache.has(workspaceId)),
  );
  const [now, setNow] = useState(() => Date.now());
  const dataWorkspaceRef = useRef<string | null>(workspaceId);
  const workspaceRevisionRef = useRef(0);
  const pendingActionRequestsRef = useRef(
    new Map<
      string,
      {
        resolve: () => void;
        reject: (error: Error) => void;
        timer: number;
      }
    >(),
  );
  const applyWaysOfWorking = useCallback(
    (waysOfWorking: WorkspaceDataState["waysOfWorking"]) => {
      if (!workspaceId) return;
      setData((current) => {
        const next = { ...current, waysOfWorking };
        workspaceDataCache.set(workspaceId, next);
        return next;
      });
    },
    [workspaceId],
  );
  const saveWaysOfWorking = useWaysOfWorkingSaver({
    capability,
    client,
    cloudOrganizationId,
    onSaved: applyWaysOfWorking,
    sessionToken,
    workspaceId,
  });
  const applyRecurringWork = useCallback(
    (work: RecurringWorkRecord) => {
      if (!workspaceId) return;
      setData((current) => {
        const recurringWork = current.recurringWork.map((item) =>
          item.id === work.id ? work : item,
        );
        const next = { ...current, recurringWork };
        workspaceDataCache.set(workspaceId, next);
        return next;
      });
    },
    [workspaceId],
  );
  const recurringWorkSettings = useRecurringWorkSettings({
    capability,
    client,
    cloudOrganizationId,
    onSaved: applyRecurringWork,
    workspaceId,
  });
  const runMissionControlHeartbeatNow = useManualMissionHeartbeat({
    capability,
    client,
    cloudOrganizationId,
    workspaceId,
  });

  useEffect(() => {
    const updateClock = () => setNow(Date.now());
    const clockInterval = window.setInterval(updateClock, 5_000);
    const updateWhenVisible = () => {
      if (document.visibilityState === "visible") updateClock();
    };
    window.addEventListener("focus", updateClock);
    document.addEventListener("visibilitychange", updateWhenVisible);
    return () => {
      window.clearInterval(clockInterval);
      window.removeEventListener("focus", updateClock);
      document.removeEventListener("visibilitychange", updateWhenVisible);
    };
  }, []);

  useEffect(() => {
    if (dataWorkspaceRef.current !== workspaceId) {
      dataWorkspaceRef.current = workspaceId;
      workspaceRevisionRef.current = 0;
      const cached = workspaceId
        ? workspaceDataCache.get(workspaceId)
        : undefined;
      setData(
        workspaceId
          ? mergePendingOnboardingSchedules(
              workspaceId,
              cached ?? emptyWorkspaceData,
            )
          : emptyWorkspaceData,
      );
      setLoading(!cached);
    }
    if (
      !workspaceId ||
      workspaceId !== cloudOrganizationId ||
      !capability ||
      status !== "connected"
    ) {
      return;
    }
    // Runtime revisions restart from one after a process reconnect.
    workspaceRevisionRef.current = 0;
    let pendingOnboardingRequestId: string | null = null;
    let pendingOnboardingRetryTimer: number | undefined;
    let pendingOnboardingRetryAttempt = 0;
    const clearPendingOnboardingRetry = () => {
      if (pendingOnboardingRetryTimer === undefined) return;
      window.clearTimeout(pendingOnboardingRetryTimer);
      pendingOnboardingRetryTimer = undefined;
    };
    const replayPendingOnboarding = () => {
      clearPendingOnboardingRetry();
      const stored = readPendingOnboardingWork(workspaceId);
      if (!stored) {
        pendingOnboardingRequestId = null;
        return;
      }
      try {
        const pending = JSON.parse(stored) as {
          jobs: OnboardingWorkJob[];
          schedules: OnboardingSchedule[];
          workspaceContext?: string;
          driver?: DriverType;
          model?: string | null;
        };
        if (!Array.isArray(pending.jobs) || !Array.isArray(pending.schedules)) {
          throw new Error("Invalid pending onboarding payload.");
        }
        pendingOnboardingRequestId = crypto.randomUUID();
        client.send({
          type: "bootstrapOnboardingWork",
          workspaceId,
          requestId: pendingOnboardingRequestId,
          jobs: pending.jobs,
          schedules: pending.schedules,
          workspaceContext: pending.workspaceContext,
          driver: pending.driver,
          model: pending.model,
          executorCapability: capability,
        });
        pendingOnboardingRetryTimer = window.setTimeout(
          replayPendingOnboarding,
          120_000,
        );
      } catch {
        window.localStorage.removeItem(
          pendingOnboardingWorkStorageKey(workspaceId),
        );
        pendingOnboardingRequestId = null;
      }
    };
    const retryPendingOnboarding = () => {
      clearPendingOnboardingRetry();
      pendingOnboardingRequestId = null;
      pendingOnboardingRetryTimer = window.setTimeout(
        replayPendingOnboarding,
        Math.min(30_000, 2_000 * 2 ** pendingOnboardingRetryAttempt),
      );
      pendingOnboardingRetryAttempt = Math.min(
        pendingOnboardingRetryAttempt + 1,
        4,
      );
    };
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type === "workspaceData" &&
        message.workspaceId === workspaceId
      ) {
        if (message.revision <= workspaceRevisionRef.current) return;
        workspaceRevisionRef.current = message.revision;
        const normalized = normalizeWorkspaceData(message);
        const persisted = clearPendingOnboardingWorkWhenPersisted(
          workspaceId,
          normalized.recurringWork,
        );
        const next = persisted
          ? normalized
          : mergePendingOnboardingSchedules(workspaceId, normalized);
        workspaceDataCache.set(workspaceId, next);
        setData(next);
        setLoading(false);
      }
      if (
        message.type === "actionRequestResolved" &&
        message.workspaceId === workspaceId
      ) {
        const pending = pendingActionRequestsRef.current.get(message.requestId);
        if (pending) {
          window.clearTimeout(pending.timer);
          pendingActionRequestsRef.current.delete(message.requestId);
          pending.resolve();
        }
        setData((current) => {
          const next = {
            ...current,
            actionItems: message.action
              ? [
                  message.action,
                  ...current.actionItems.filter(
                    (item) => item.id !== message.actionItemId,
                  ),
                ]
              : current.actionItems.filter(
                  (item) => item.id !== message.actionItemId,
                ),
          };
          workspaceDataCache.set(workspaceId, next);
          return next;
        });
      }
      if (message.type === "error" && message.requestId) {
        const pending = pendingActionRequestsRef.current.get(message.requestId);
        if (pending) {
          window.clearTimeout(pending.timer);
          pendingActionRequestsRef.current.delete(message.requestId);
          const error = new Error(message.message);
          toast.error(error.message);
          pending.reject(error);
        }
      }
      if (
        message.type === "onboardingWorkBootstrapped" &&
        message.workspaceId === workspaceId &&
        message.requestId === pendingOnboardingRequestId
      ) {
        clearPendingOnboardingRetry();
        pendingOnboardingRequestId = null;
        pendingOnboardingRetryAttempt = 0;
        // The queued schedules stay visible until a workspace snapshot proves
        // they are durable. The next refresh clears the handoff.
      }
      if (
        message.type === "error" &&
        message.requestId === pendingOnboardingRequestId
      ) {
        if (message.code === "deployment_not_found") {
          clearPendingOnboardingRetry();
          pendingOnboardingRequestId = null;
        } else {
          retryPendingOnboarding();
        }
      }
    });
    const refresh = () => {
      client.send({
        type: "listWorkspaceData",
        workspaceId,
        executorCapability: capability,
      });
    };
    refresh();
    const refreshInterval = window.setInterval(refresh, 15_000);
    const refreshOnFocus = () => refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    replayPendingOnboarding();
    return () => {
      clearPendingOnboardingRetry();
      window.clearInterval(refreshInterval);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      unsubscribe();
    };
  }, [capability, client, cloudOrganizationId, status, workspaceId]);

  const liveData = useMemo(
    () => ({
      ...data,
      recurringWork: data.recurringWork.map((work) => ({
        ...work,
        upcomingRuns: work.upcomingRuns?.filter((timestamp) => timestamp > now),
      })),
    }),
    [data, now],
  );

  const saveCampaign = (campaign: CampaignRecord) => {
    if (!workspaceId || workspaceId !== cloudOrganizationId || !capability) {
      return;
    }
    setData((current) => {
      const next = {
        ...current,
        campaigns: [
          campaign,
          ...current.campaigns.filter((item) => item.id !== campaign.id),
        ],
      };
      workspaceDataCache.set(workspaceId, next);
      return next;
    });
    client.send({
      type: "saveCampaign",
      workspaceId,
      campaign,
      executorCapability: capability,
    });
  };

  const bootstrapOnboardingWork = useCallback(
    (
      jobs: OnboardingWorkJob[],
      schedules: OnboardingSchedule[],
      workspaceContext?: string,
      driver?: DriverType,
      model?: string | null,
    ) => {
      if (workspaceId) {
        window.localStorage.setItem(
          pendingOnboardingWorkStorageKey(workspaceId),
          JSON.stringify({ jobs, schedules, workspaceContext, driver, model }),
        );
        setData((current) => {
          const next = mergePendingOnboardingSchedules(workspaceId, current);
          workspaceDataCache.set(workspaceId, next);
          return next;
        });
      }
      if (
        !workspaceId ||
        workspaceId !== cloudOrganizationId ||
        !capability ||
        status !== "connected"
      ) {
        return Promise.reject(
          new Error("Chief is still connecting to this workspace."),
        );
      }
      const requestId = crypto.randomUUID();
      return new Promise<string>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          unsubscribe();
          reject(new Error("Chief could not finish preparing this workspace."));
        }, 120_000);
        const unsubscribe = client.subscribe((message) => {
          if (
            message.type === "onboardingWorkBootstrapped" &&
            message.workspaceId === workspaceId &&
            message.requestId === requestId
          ) {
            window.clearTimeout(timeout);
            unsubscribe();
            // A workspace-data refresh removes the durable handoff after the
            // saved schedules are present in the returned snapshot.
            if (pendingOnboardingSchedules(workspaceId).length === 0) {
              window.localStorage.removeItem(
                pendingOnboardingWorkStorageKey(workspaceId),
              );
            }
            resolve(message.chatId);
          }
          if (message.type === "error" && message.requestId === requestId) {
            window.clearTimeout(timeout);
            unsubscribe();
            reject(new Error(message.message));
          }
        });
        client.send({
          type: "bootstrapOnboardingWork",
          workspaceId,
          requestId,
          jobs,
          schedules,
          workspaceContext,
          driver,
          model,
          executorCapability: capability,
        });
      });
    },
    [capability, client, cloudOrganizationId, status, workspaceId],
  );

  const saveRecurringWork = (work: RecurringWorkRecord) => {
    if (!workspaceId || workspaceId !== cloudOrganizationId || !capability) {
      return;
    }
    setData((current) => {
      const next = {
        ...current,
        recurringWork: current.recurringWork.map((item) =>
          item.id === work.id ? work : item,
        ),
      };
      workspaceDataCache.set(workspaceId, next);
      return next;
    });
    client.send({
      type: "saveRecurringWork",
      workspaceId,
      work,
      executorCapability: capability,
    });
  };

  const runRecurringWorkNow = (recurringWorkId: string) => {
    if (!workspaceId || workspaceId !== cloudOrganizationId || !capability) {
      return;
    }
    client.send({
      type: "runRecurringWorkNow",
      workspaceId,
      recurringWorkId,
      executorCapability: capability,
    });
  };

  const expandRecurringWorkGrant = (
    recurringWorkId: string,
    addTools: string[],
    rerun: boolean,
  ) => {
    if (!workspaceId || workspaceId !== cloudOrganizationId || !capability) {
      return;
    }
    client.send({
      type: "expandRecurringWorkGrant",
      workspaceId,
      recurringWorkId,
      addTools,
      rerun,
      executorCapability: capability,
    });
  };

  const dismissActionItem = (actionItemId: string) => {
    if (!workspaceId || workspaceId !== cloudOrganizationId || !capability) {
      return;
    }
    setData((current) => {
      const next = {
        ...current,
        actionItems: current.actionItems.filter(
          (item) => item.id !== actionItemId,
        ),
      };
      workspaceDataCache.set(workspaceId, next);
      return next;
    });
    client.send({
      type: "dismissActionItem",
      workspaceId,
      actionItemId,
      executorCapability: capability,
    });
  };

  const resolveActionRequest = (
    actionItemId: string,
    requestId: string,
    answers: Record<string, string>,
    values: Record<string, string>,
    setup?: { chatId: string; domain: string },
  ) => {
    if (!workspaceId || workspaceId !== cloudOrganizationId || !capability) {
      return Promise.reject(new Error("Workspace runtime is unavailable."));
    }
    return new Promise<void>((resolve, reject) => {
      const existing = pendingActionRequestsRef.current.get(requestId);
      if (existing) window.clearTimeout(existing.timer);
      const timer = window.setTimeout(() => {
        pendingActionRequestsRef.current.delete(requestId);
        const error = new Error(
          "Chief did not confirm the saved input. Try again.",
        );
        toast.error(error.message);
        reject(error);
      }, 30_000);
      pendingActionRequestsRef.current.set(requestId, {
        resolve,
        reject,
        timer,
      });
      client.send({
        type: "resolveActionRequest",
        workspaceId,
        actionItemId,
        requestId,
        answers,
        values,
        setup,
        executorCapability: capability,
      });
    });
  };

  const deleteRecurringWork = (recurringWorkId: string) => {
    if (!workspaceId || workspaceId !== cloudOrganizationId || !capability) {
      return;
    }
    setData((current) => {
      const next = {
        ...current,
        recurringWork: current.recurringWork.filter(
          (item) => item.id !== recurringWorkId,
        ),
      };
      workspaceDataCache.set(workspaceId, next);
      return next;
    });
    client.send({
      type: "deleteRecurringWork",
      workspaceId,
      recurringWorkId,
      executorCapability: capability,
    });
  };

  return {
    ...liveData,
    loading,
    now,
    onboardingBootstrapReady:
      status === "connected" &&
      Boolean(capability) &&
      workspaceId === cloudOrganizationId,
    onboardingBootstrapError: capabilityError,
    bootstrapOnboardingWork,
    saveCampaign,
    saveRecurringWork,
    runRecurringWorkNow,
    deleteRecurringWork,
    dismissActionItem,
    resolveActionRequest,
    expandRecurringWorkGrant,
    saveWaysOfWorking,
    runMissionControlHeartbeatNow,
    saveRecurringWorkSettings: recurringWorkSettings.save,
    rotateRecurringWorkWebhook: recurringWorkSettings.rotateWebhook,
  };
}

type WorkspaceDataContextValue = ReturnType<typeof useWorkspaceDataSource>;

const WorkspaceDataContext = createContext<WorkspaceDataContextValue | null>(
  null,
);

function WorkspaceDataProvider({ children }: { children: ReactNode }) {
  const { cloudOrganizationId } = useAuth();
  const value = useWorkspaceDataSource(cloudOrganizationId);
  return (
    <WorkspaceDataContext.Provider value={value}>
      {children}
    </WorkspaceDataContext.Provider>
  );
}

export function useWorkspaceData(workspaceId: string | null) {
  const value = useContext(WorkspaceDataContext);
  if (!value) {
    throw new Error("useWorkspaceData must be used inside RuntimeProvider");
  }
  // Consumers still pass the active workspace id for a narrow, explicit API.
  // The provider owns the subscription so route changes never create a second
  // listener or briefly replace live data with an empty page.
  void workspaceId;
  return value;
}

interface DiagnosticsState {
  sessions: SessionRecord[];
  events: DiagnosticEventRecord[];
}

const diagnosticsCache = new Map<string, DiagnosticsState>();

export function useDiagnostics(workspaceId: string | null) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [state, setState] = useState<
    DiagnosticsState & { workspaceId: string | null; loaded: boolean }
  >(() => {
    const cached = workspaceId ? diagnosticsCache.get(workspaceId) : undefined;
    return {
      workspaceId,
      sessions: cached?.sessions ?? [],
      events: cached?.events ?? [],
      loaded: Boolean(cached),
    };
  });
  const cached = workspaceId ? diagnosticsCache.get(workspaceId) : undefined;
  const active =
    state.workspaceId === workspaceId
      ? state
      : {
          workspaceId,
          sessions: cached?.sessions ?? [],
          events: cached?.events ?? [],
          loaded: Boolean(cached),
        };

  useEffect(() => {
    if (
      !workspaceId ||
      workspaceId !== cloudOrganizationId ||
      !capability ||
      status !== "connected"
    ) {
      return;
    }
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type === "diagnostics" &&
        message.workspaceId === workspaceId
      ) {
        const next = {
          sessions: message.sessions,
          events: message.events,
        };
        diagnosticsCache.set(workspaceId, next);
        setState({ workspaceId, ...next, loaded: true });
      }
    });
    client.send({
      type: "listDiagnostics",
      workspaceId,
      executorCapability: capability,
    });
    return () => {
      unsubscribe();
    };
  }, [capability, client, cloudOrganizationId, status, workspaceId]);

  return {
    sessions: active.sessions,
    events: active.events,
    loading: Boolean(workspaceId && !active.loaded),
  };
}

/**
 * Which required secret keys already exist on this machine, and a way to
 * store new ones, with no agent session involved. Used to gate Connect
 * buttons behind credential collection for integrations that are known to
 * need values only the user can provide.
 */
export {
  useAgentPreferences,
  useWorkspaceEmailPreview,
  useWorkspaceFile,
  useWorkspaceFiles,
} from "./runtime-files";
export {
  useDisconnectGoogleAnalytics,
  useStoredInputs,
  useWorkspaceEnvironmentVariables,
} from "./runtime-settings";

// ---- Chat state ----

export interface PendingApproval {
  requestId: string;
  toolName: string;
  input: unknown;
  threadRootId?: string;
}

export interface PendingQuestion {
  requestId: string;
  questions: AgentQuestion[];
}

export interface ChatControlState {
  status: "idle" | "running";
  /** True after the runtime has emitted real output for the current turn. */
  hasAgentOutput: boolean;
  /** Tool calls waiting on the user's allow/deny decision. */
  approvals: PendingApproval[];
  /** Agent questions waiting on the user's answers. */
  questions: PendingQuestion[];
  toolProgress: Record<string, string>;
  lastCostUsd?: number;
  error?: string;
}

const emptyChatControls: ChatControlState = {
  status: "idle",
  hasAgentOutput: false,
  approvals: [],
  questions: [],
  toolProgress: {},
};

/** Runtime events carry process state and interactions; durable content lives
 * exclusively in the AI SDK message array. */
function reduceChatControls(
  controls: ChatControlState,
  event: AgentEvent,
): ChatControlState {
  switch (event.type) {
    case "stream":
      return { ...controls, status: "running", hasAgentOutput: true };
    case "message":
      return {
        ...controls,
        status: event.role === "user" ? "running" : controls.status,
        hasAgentOutput: event.role !== "user",
        error: event.role === "user" ? undefined : controls.error,
      };
    case "toolProgress": {
      const current = controls.toolProgress[event.toolUseId] ?? "";
      return {
        ...controls,
        hasAgentOutput: true,
        toolProgress: {
          ...controls.toolProgress,
          [event.toolUseId]: `${current}${event.text}`.slice(-8_000),
        },
      };
    }
    case "permission":
      return {
        ...controls,
        hasAgentOutput: true,
        approvals: controls.approvals.some(
          (approval) => approval.requestId === event.requestId,
        )
          ? controls.approvals
          : [
              ...controls.approvals,
              {
                requestId: event.requestId,
                toolName: event.toolName,
                input: event.input,
                threadRootId: event.threadRootId,
              },
            ],
      };
    case "permissionResolved":
      return {
        ...controls,
        approvals: controls.approvals.filter(
          (approval) => approval.requestId !== event.requestId,
        ),
      };
    case "question":
      return {
        ...controls,
        hasAgentOutput: true,
        questions: controls.questions.some(
          (question) => question.requestId === event.requestId,
        )
          ? controls.questions
          : [
              ...controls.questions,
              { requestId: event.requestId, questions: event.questions },
            ],
      };
    case "questionResolved":
      return {
        ...controls,
        questions: controls.questions.filter(
          (question) => question.requestId !== event.requestId,
        ),
      };
    case "result":
      return {
        ...controls,
        status: "idle",
        approvals: [],
        questions: [],
        lastCostUsd: event.costUsd ?? controls.lastCostUsd,
        error: event.ok ? undefined : visibleRuntimeError(event.error),
      };
    case "status":
      return {
        ...controls,
        status: event.status === "running" ? "running" : "idle",
        error: event.status === "running" ? undefined : controls.error,
      };
    case "error":
      return {
        ...controls,
        error: visibleRuntimeError(event.message),
        status: "idle",
      };
    case "exit":
      return {
        ...controls,
        status: "idle",
        error:
          event.code && event.code !== 0
            ? visibleRuntimeError(
                `Agent process exited with code ${event.code}.`,
              )
            : controls.error,
      };
    default:
      return controls;
  }
}

export function messageBlocks(message: ChiefUIMessage): ContentBlock[] {
  return message.parts.flatMap((part): ContentBlock[] => {
    if (part.type === "text") return [{ type: "text", text: part.text }];
    if (part.type === "file" && part.mediaType.startsWith("image/")) {
      return [
        {
          type: "image",
          name: part.filename ?? "Image",
          mediaType: part.mediaType,
          url: part.url,
        },
      ];
    }
    if (part.type === "reasoning") {
      return [{ type: "thinking", thinking: part.text }];
    }
    if (part.type === "dynamic-tool") {
      const use: ContentBlock = {
        type: "tool_use",
        id: part.toolCallId,
        name: part.toolName,
        input: part.input,
      };
      if (part.state === "output-available") {
        return [
          use,
          {
            type: "tool_result",
            tool_use_id: part.toolCallId,
            content: part.output,
          },
        ];
      }
      if (part.state === "output-error") {
        return [
          use,
          {
            type: "tool_result",
            tool_use_id: part.toolCallId,
            content: part.errorText,
            is_error: true,
          },
        ];
      }
      return [use];
    }
    if (
      part.type === "data-chart" ||
      part.type === "data-table" ||
      part.type === "data-document"
    ) {
      return [part];
    }
    return [];
  });
}

function replayStreamingText(events: AgentEvent[]) {
  let text = "";
  for (const event of events) {
    if (event.type === "stream") text += event.text;
    if (
      event.type === "message" ||
      event.type === "result" ||
      event.type === "error" ||
      event.type === "exit"
    ) {
      text = "";
    }
  }
  return text;
}

function useRuntimeChat(
  chatId: string | null,
  mode: "open" | "observe",
  initialExecution?: ChatExecutionSelection,
  selectedExecution?: ChatExecutionSelection,
  access?: "full" | "guarded",
  purpose?: "integration-setup" | "analytics-report",
  integrationDomain?: string,
  channelId?: string,
  agentId?: string,
  wakeOnMentionOnly = false,
) {
  const { client, status: runtimeStatus } = useRuntime();
  const { events: channelEvents, loaded: channelEventsLoaded } =
    useChannelEvents(channelId ?? null);
  const { user } = useAuth();
  const senderName = user?.name.trim();
  const {
    cloudOrganizationId,
    capability: executorCapability,
    error: capabilityError,
  } = useWorkspaceCapability();
  const [controls, setControls] = useState<ChatControlState>(emptyChatControls);
  const pendingStreamRef = useRef("");
  const [chatReady, setChatReady] = useState(false);
  const [execution, setExecution] = useState<
    ChatExecutionSelection | undefined
  >(undefined);
  const executionRef = useRef<ChatExecutionSelection | undefined>(
    selectedExecution ?? initialExecution,
  );
  useEffect(() => {
    executionRef.current = selectedExecution ?? initialExecution ?? execution;
  }, [execution, initialExecution, selectedExecution]);
  const transport = useMemo<ChatTransport<ChiefUIMessage>>(
    () => ({
      sendMessages: ({ messages }) => {
        const message = messages.at(-1);
        const text =
          message?.parts
            .flatMap((part) => (part.type === "text" ? [part.text] : []))
            .join("\n")
            .trim() ?? "";
        const attachments = message?.parts.flatMap((part) =>
          part.type === "file" && part.mediaType.startsWith("image/")
            ? [
                {
                  name: part.filename ?? "Image",
                  mediaType: part.mediaType,
                  url: part.url,
                },
              ]
            : [],
        );
        if (
          mode === "open" &&
          chatId &&
          message?.role === "user" &&
          (text || attachments?.length) &&
          cloudOrganizationId &&
          executorCapability
        ) {
          const context = {
            threadRootId: message.metadata?.threadRootId,
            mentions: message.metadata?.mentions,
            interruptActive: message.metadata?.interruptActive,
          };
          const expectsReply =
            !wakeOnMentionOnly || Boolean(context.mentions?.length);
          setControls((current) => ({
            ...current,
            status: expectsReply && !wakeOnMentionOnly ? "running" : "idle",
            hasAgentOutput: false,
            toolProgress: {},
            error: undefined,
          }));
          client.send({
            type: "sendMessage",
            workspaceId: cloudOrganizationId,
            chatId,
            messageId: message.id,
            text,
            attachments,
            threadRootId: context.threadRootId,
            mentions: context.mentions,
            interruptActive: context.interruptActive,
            senderName: senderName?.length ? senderName : "You",
            execution: executionRef.current,
            executorCapability,
          });
        }
        return Promise.resolve(
          new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
        );
      },
      reconnectToStream: () => Promise.resolve(null),
    }),
    [
      chatId,
      client,
      cloudOrganizationId,
      executorCapability,
      mode,
      senderName,
      wakeOnMentionOnly,
    ],
  );
  const { messages, sendMessage, setMessages, stop } = useChat<ChiefUIMessage>({
    id: chatId ?? "inactive-chief-chat",
    generateId: () => crypto.randomUUID(),
    transport,
  });
  const initializedChatKeyRef = useRef<string | null>(null);
  const loadedHistoryKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!capabilityError) return;
    setControls((current) => ({
      ...current,
      status: "idle",
      error: capabilityError,
    }));
  }, [capabilityError]);

  useEffect(() => {
    if (
      !chatId ||
      !cloudOrganizationId ||
      !executorCapability ||
      runtimeStatus !== "connected"
    ) {
      return;
    }
    const chatKey = `${cloudOrganizationId}:${chatId}`;
    const changedChat = initializedChatKeyRef.current !== chatKey;
    if (changedChat) {
      initializedChatKeyRef.current = chatKey;
      loadedHistoryKeyRef.current = null;
      setControls(emptyChatControls);
      pendingStreamRef.current = "";
      // Restore the last-known transcript so returning to a channel is instant
      // instead of flashing an empty frame while history reloads. The server
      // snapshot replaces/merges it moments later.
      const cached = chatTranscriptCache.get(chatKey);
      setMessages(cached ? deduplicateDocumentParts(cached) : []);
      setChatReady(cached ? true : false);
      setExecution(undefined);
    }
    let cancelled = false;
    if (mode === "observe") {
      client.send({
        type: "observeChat",
        chatId,
        workspaceId: cloudOrganizationId,
        executorCapability,
      });
    } else {
      // The brand brief rides along so the session opens already primed; the
      // org list is cached, so this resolves fast and the open stays snappy.
      void buildWorkspaceContext(cloudOrganizationId)
        .catch(() => undefined)
        .then((workspaceContext) => {
          if (cancelled) return;
          client.send({
            type: "openChat",
            chatId,
            workspaceContext,
            workspaceId: cloudOrganizationId,
            execution: executionRef.current,
            access,
            purpose,
            integrationDomain,
            channelId,
            agentId,
            executorCapability,
          });
        });
    }

    const unsub = client.subscribe((msg) => {
      if (msg.type === "error" && msg.chatId === chatId) {
        setControls((current) => ({
          ...current,
          error: msg.message,
          status: "idle",
        }));
        return;
      }
      if (
        msg.type === "chatOpened" &&
        msg.workspaceId === cloudOrganizationId &&
        msg.chatId === chatId
      ) {
        setExecution(msg.execution);
        return;
      }
      if (
        msg.type === "history" &&
        msg.workspaceId === cloudOrganizationId &&
        msg.chatId === chatId
      ) {
        pendingStreamRef.current = replayStreamingText(msg.events);
        const incoming = deduplicateDocumentParts(msg.messages);
        chatTranscriptCache.set(chatKey, incoming);
        if (loadedHistoryKeyRef.current === chatKey) {
          setMessages((current) => mergeRuntimeHistory(current, incoming));
        } else {
          loadedHistoryKeyRef.current = chatKey;
          setMessages(incoming);
        }
        const replayedControls = msg.events.reduce(
          reduceChatControls,
          emptyChatControls,
        );
        setControls({
          ...replayedControls,
          status: msg.running ? "running" : "idle",
        });
        setChatReady(true);
        return;
      }
      if (
        msg.type === "message" &&
        msg.workspaceId === cloudOrganizationId &&
        msg.chatId === chatId
      ) {
        if (import.meta.env.DEV) {
          const text = msg.message.parts
            .flatMap((part) => (part.type === "text" ? [part.text] : []))
            .join(" ")
            .slice(0, 80);
          const toolNames = msg.message.parts
            .filter(
              (
                part,
              ): part is Extract<
                ChiefUIMessage["parts"][number],
                { type: "dynamic-tool" }
              > => part.type === "dynamic-tool",
            )
            .map((part) => part.toolName);
          console.log(
            "[chief-msg-in]",
            JSON.stringify({
              id: msg.message.id,
              role: msg.message.role,
              threadRootId: msg.message.metadata?.threadRootId ?? null,
              text,
              toolNames,
              parts: msg.message.parts.length,
            }),
          );
        }
        const hasAssistantText =
          msg.message.role === "assistant" &&
          msg.message.parts.some(
            (part) => part.type === "text" && part.text.trim().length > 0,
          );
        const bufferedText = pendingStreamRef.current;
        if (hasAssistantText && bufferedText) {
          pendingStreamRef.current = "";
          const completed = mergeRuntimeMessage(
            [
              {
                id: `stream:${chatId}`,
                role: "assistant",
                parts: [
                  { type: "text", text: bufferedText, state: "streaming" },
                ],
              },
            ],
            msg.message,
          );
          setMessages((current) =>
            completed.reduce(
              (next, message) => mergeRuntimeMessage(next, message),
              current,
            ),
          );
        } else {
          setMessages((current) => mergeRuntimeMessage(current, msg.message));
        }
        return;
      }
      if (msg.type !== "event" || msg.chatId !== chatId) return;
      if (msg.event.type === "stream") {
        pendingStreamRef.current += msg.event.text;
      }
      if (msg.event.type === "result" && pendingStreamRef.current.trim()) {
        const completedText = pendingStreamRef.current;
        pendingStreamRef.current = "";
        setMessages((current) => [
          ...current,
          {
            id: `stream:${chatId}`,
            role: "assistant",
            parts: [{ type: "text", text: completedText, state: "streaming" }],
          },
        ]);
      }
      setControls((current) => reduceChatControls(current, msg.event));
    });
    return () => {
      cancelled = true;
      // Navigating away unloads the chat. Reset the history marker so the
      // next open of the SAME chat replaces (not merges) the transcript — the
      // server history is authoritative and merging it into the stale live
      // buffer re-inserted every thread message into the timeline.
      initializedChatKeyRef.current = null;
      loadedHistoryKeyRef.current = null;
      client.send({
        type: "closeChat",
        workspaceId: cloudOrganizationId,
        chatId,
        executorCapability,
      });
      unsub();
    };
  }, [
    chatId,
    setMessages,
    client,
    runtimeStatus,
    cloudOrganizationId,
    executorCapability,
    mode,
    access,
    purpose,
    integrationDomain,
    channelId,
    agentId,
  ]);

  const interrupt = () => {
    if (chatId && cloudOrganizationId && executorCapability) {
      client.send({
        type: "interruptChat",
        workspaceId: cloudOrganizationId,
        chatId,
        executorCapability,
      });
    }
  };

  const respondPermission = (requestId: string, behavior: "allow" | "deny") => {
    if (chatId && cloudOrganizationId && executorCapability) {
      client.send({
        type: "respondPermission",
        workspaceId: cloudOrganizationId,
        chatId,
        requestId,
        behavior,
        executorCapability,
      });
    }
  };

  const respondQuestion = (
    requestId: string,
    answers: Record<string, string> | null,
  ) => {
    if (chatId && cloudOrganizationId && executorCapability) {
      client.send({
        type: "respondQuestion",
        workspaceId: cloudOrganizationId,
        chatId,
        requestId,
        answers,
        executorCapability,
      });
    }
  };

  const provideInput = (
    request: InputRequest,
    values: Record<string, string>,
  ) => {
    if (chatId && cloudOrganizationId && executorCapability) {
      client.send({
        type: "provideInput",
        workspaceId: cloudOrganizationId,
        chatId,
        request,
        values,
        executorCapability,
      });
    }
  };

  const sendMessageWithContext = useCallback(
    (
      text: string,
      context?: {
        threadRootId?: string;
        mentions?: string[];
        interruptActive?: boolean;
      },
      attachments?: MessageAttachment[],
    ) => {
      void sendMessage({
        text,
        metadata: {
          createdAt: Date.now(),
          ...(context?.threadRootId
            ? { threadRootId: context.threadRootId }
            : {}),
          ...(context?.mentions?.length ? { mentions: context.mentions } : {}),
          ...(context?.interruptActive ? { interruptActive: true } : {}),
        },
        files: attachments?.map((attachment) => ({
          type: "file" as const,
          filename: attachment.name,
          mediaType: attachment.mediaType,
          url: attachment.url,
        })),
      });
    },
    [sendMessage],
  );

  const visibleMessages = useMemo(() => {
    // A provider restart replays the session's history through the driver, and
    // each replayed message is emitted as a fresh transcript message (new id,
    // same toolCallId/text, no threadRootId). Those copies would render the
    // thread's tool/browser UI in the main timeline. dropReplayedMessages keeps
    // only the original thread-attached copies.
    if (!channelId) {
      return dropReplayedMessages(messages);
    }
    return projectChannelTimeline(messages, channelEvents);
  }, [channelEvents, channelId, messages]);

  return {
    messages: visibleMessages,
    controls,
    sendMessage,
    sendMessageWithContext,
    interrupt,
    stop,
    respondPermission,
    respondQuestion,
    provideInput,
    chatReady,
    // The channel content is only rendered once both the transcript and its
    // channel events have resolved, so elements never pop in after entry.
    channelResolved: chatReady && (!channelId || channelEventsLoaded),
    execution,
  };
}

/**
 * Opens the low-level runtime connection for one interactive Chief
 * conversation. UI-specific draft, timeline, and presentation state belongs to
 * the composed chat hooks rather than this transport-facing hook.
 */
export function useChiefChat(
  chatId: string | null,
  initialExecution?: ChatExecutionSelection,
  selectedExecution?: ChatExecutionSelection,
  access?: "full" | "guarded",
  destination?: {
    channelId?: string;
    agentId?: string;
    wakeOnMentionOnly?: boolean;
    integrationDomain?: string;
  },
) {
  return useRuntimeChat(
    chatId,
    "open",
    initialExecution,
    selectedExecution,
    access,
    destination?.integrationDomain ? "integration-setup" : undefined,
    destination?.integrationDomain,
    destination?.channelId,
    destination?.agentId,
    destination?.wakeOnMentionOnly,
  );
}

export function useAnalyticsReportChat(
  chatId: string | null,
  access: "full" | "guarded",
) {
  return useRuntimeChat(
    chatId,
    "open",
    undefined,
    undefined,
    access,
    "analytics-report",
  );
}

/** A hard read-only transcript API. It intentionally exposes no send method. */
export function useObservedChat(
  chatId: string | null,
  recurringWorkId?: string,
) {
  const observed = useRuntimeChat(chatId, "observe");
  const { client } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const provideInput = (
    request: InputRequest,
    values: Record<string, string>,
  ) => {
    if (!chatId || !cloudOrganizationId || !capability) return;
    client.send({
      type: "provideInput",
      workspaceId: cloudOrganizationId,
      chatId,
      request,
      values,
      executorCapability: capability,
      recurringWorkId,
    });
  };
  return {
    messages: observed.messages,
    controls: observed.controls,
    chatReady: observed.chatReady,
    provideInput,
  };
}
