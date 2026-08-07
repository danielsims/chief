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
  AgentPreference,
  AgentQuestion,
  BrowserRunRecord,
  CampaignRecord,
  ChannelEvent,
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
  WorkspaceChannel,
  WorkspaceEnvironmentVariable,
  WorkspaceFileRecord,
  WorkspaceFileSnapshot,
} from "@chief/agent-runtime/types";
import { api } from "@chief/backend/convex/_generated/api";

import type {
  RuntimeBrowserRuns,
  RuntimeBrowserSession,
  RuntimeBrowserSessions,
} from "./browser-sessions";
import type { ChannelReactionSummary } from "./channel-reactions";
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
  updateBrowserSession,
  upsertBrowserSession,
  upsertBrowserRun as upsertRuntimeBrowserRun,
} from "./browser-sessions";
import {
  applyOptimisticChannelReaction,
  foldChannelReactions,
} from "./channel-reactions";
import {
  channelEventSourceId,
  channelEventThreadRootId,
} from "./channel-read-state";
import { navigateApp, notifySystem } from "./notifications";
import {
  deduplicateDocumentParts,
  dropReplayedMessages,
  mergeRuntimeHistory,
  mergeRuntimeMessage,
  visibleRuntimeError,
} from "./runtime-messages";
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
  const [capability, setCapability] = useState<ExecutorCapability | null>(
    cloudOrganizationId
      ? (workspaceCapabilityCache.get(cloudOrganizationId) ?? null)
      : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);

  useEffect(() => {
    if (!cloudOrganizationId || !isAuthenticated) {
      setCapability(null);
      setError(null);
      return;
    }
    const cached = workspaceCapabilityCache.get(cloudOrganizationId);
    if (cached) {
      setCapability(cached);
      setError(null);
    } else {
      setCapability(null);
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
        setCapability(next);
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

  return { cloudOrganizationId, capability, error };
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
    this.statusListener("connecting");
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

  private clearConnectTimer() {
    if (this.connectTimer === null) return;
    window.clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private scheduleReconnect() {
    if (this.closed || this.reconnectTimer !== null) return;
    this.statusListener("connecting");
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
  anchorBrowserSession: (conversationId: string, messageId: string) => void;
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
  reportBrowserUrl: (conversationId: string, url: string) => void;
  reloadBrowser: (conversationId: string) => void;
  takeBrowserControl: (conversationId: string) => void;
  closeBrowser: (conversationId: string) => void;
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
  const completeBrowser = useCallback(
    (conversationId: string, runId?: string) => {
      const timer = browserCursorTimersRef.current.get(conversationId);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        browserCursorTimersRef.current.delete(conversationId);
      }
      browserOwnersRef.current.delete(conversationId);
      setBrowserSessions((current) => {
        return completeBrowserSession(current, conversationId);
      });
      if (runId) {
        setBrowserRuns((current) => [
          ...completeRuntimeBrowserRun(current, runId),
        ]);
      }
    },
    [],
  );
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
      const existing = browserSessions[conversationId];
      const runId =
        options?.browserRunId ??
        (existing?.status === "active" ? existing.runId : null);
      const threadRootId =
        options?.threadRootId ?? existing?.threadRootId ?? null;
      const pending = {
        workspaceId: cloudOrganizationId,
        conversationId,
        ...(threadRootId ? { threadRootId } : {}),
        url,
      };
      browserOwnersRef.current.set(conversationId, pending);
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
            options?.anchorMessageId ??
            (existing?.runId === runId ? existing.anchorMessageId : null),
          status: "active",
          operatingLabel: null,
          operating: false,
          agentCursor: null,
        }),
      );
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
    (conversationId: string) => {
      const session = browserSessions[conversationId];
      if (!session) return;
      client.send({
        type: "browserReload",
        workspaceId: session.workspaceId,
        conversationId,
      });
    },
    [browserSessions, client],
  );
  const reportBrowserUrl = useCallback(
    (conversationId: string, url: string) => {
      const session = browserSessions[conversationId];
      if (!session) return;
      setBrowserSessions((current) =>
        updateBrowserSession(current, conversationId, (value) => ({
          ...value,
          url,
        })),
      );
      client.send({
        type: "browserUrlChanged",
        workspaceId: session.workspaceId,
        conversationId,
        url,
      });
    },
    [browserSessions, client],
  );
  const closeBrowser = useCallback(
    (conversationId: string) => {
      const owner = browserOwnersRef.current.get(conversationId);
      const runId =
        browserSessionsRef.current[conversationId]?.runId ?? undefined;
      if (owner) {
        client.send({
          type: "browserClose",
          ...owner,
        });
      }
      completeBrowser(conversationId, runId);
    },
    [client, completeBrowser],
  );
  const takeBrowserControl = useCallback(
    (conversationId: string) => {
      const session = browserSessions[conversationId];
      if (!session) return;
      const executorCapability = workspaceCapabilityCache.get(
        session.workspaceId,
      );
      if (!executorCapability) return;
      client.send({
        type: "interruptChat",
        workspaceId: session.workspaceId,
        chatId: conversationId,
        executorCapability,
      });
    },
    [browserSessions, client],
  );
  const anchorBrowserSession = useCallback(
    (conversationId: string, messageId: string) => {
      const runId = browserSessions[conversationId]?.runId;
      setBrowserSessions((current) =>
        anchorRuntimeBrowserSession(current, conversationId, messageId),
      );
      if (!runId || !cloudOrganizationId || !capability) return;
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
    [browserSessions, capability, client, cloudOrganizationId],
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
        setBrowserRuns(msg.runs);
      }
      if (
        (msg.type === "browserPrepare" || msg.type === "browserNavigate") &&
        msg.workspaceId === cloudOrganizationId
      ) {
        const currentOwner = browserOwners.get(msg.conversationId);
        const owner = currentOwner ?? {
          workspaceId: msg.workspaceId,
          conversationId: msg.conversationId,
          ...(msg.threadRootId ? { threadRootId: msg.threadRootId } : {}),
        };
        browserOwners.set(msg.conversationId, owner);
        setBrowserSessions((current) => {
          const existing = current[msg.conversationId];
          return {
            ...current,
            [msg.conversationId]: {
              runId: msg.browserRunId,
              url: msg.url,
              streamUrl: msg.type === "browserNavigate" ? msg.streamUrl : null,
              conversationId: msg.conversationId,
              parentConversationId:
                existing?.parentConversationId ??
                msg.parentConversationId ??
                null,
              workspaceId: msg.workspaceId,
              threadRootId: existing?.threadRootId ?? msg.threadRootId ?? null,
              anchorMessageId:
                existing?.status === "active" &&
                existing.runId === msg.browserRunId
                  ? existing.anchorMessageId
                  : (msg.anchorMessageId ?? null),
              status: "active",
              operatingLabel: existing?.operatingLabel ?? null,
              operating: existing?.operating ?? false,
              agentCursor: existing?.agentCursor ?? null,
            },
          };
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
        browserOwners.get(msg.conversationId)?.workspaceId === msg.workspaceId
      ) {
        const currentTimer = browserCursorTimers.get(msg.conversationId);
        if (msg.cursor && currentTimer !== undefined) {
          window.clearTimeout(currentTimer);
          browserCursorTimers.delete(msg.conversationId);
        }
        setBrowserSessions((current) => {
          const session = current[msg.conversationId];
          if (!session) return current;
          return {
            ...current,
            [msg.conversationId]:
              msg.phase === "started"
                ? beginBrowserActivity(session, msg)
                : completeBrowserActivity(session, msg),
          };
        });
        if (msg.phase === "completed" && msg.cursor) {
          const hide = window.setTimeout(() => {
            setBrowserSessions((current) => {
              const session = current[msg.conversationId];
              if (!session) return current;
              return {
                ...current,
                [msg.conversationId]: hideBrowserCursor(session),
              };
            });
            browserCursorTimers.delete(msg.conversationId);
          }, 4_000);
          browserCursorTimers.set(msg.conversationId, hide);
        }
      }
      const browserOwner =
        msg.type === "browserClosed"
          ? browserOwners.get(msg.conversationId)
          : undefined;
      if (
        msg.type === "browserClosed" &&
        msg.workspaceId === cloudOrganizationId &&
        msg.workspaceId === browserOwner?.workspaceId &&
        msg.conversationId === browserOwner.conversationId
      ) {
        completeBrowser(msg.conversationId, msg.browserRunId);
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
        for (const [conversationId, owner] of browserOwners) {
          if (owner.workspaceId === msg.workspaceId) {
            closeBrowser(conversationId);
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
        const isWorkNotice = msg.notice.kind === "work-completed";
        const route = isWorkNotice ? "/schedule" : "/";
        toast(msg.notice.title, {
          description: msg.notice.detail,
          duration: 10_000,
          action: {
            label: isWorkNotice ? "View schedule" : "Review action",
            onClick: () => navigateApp(route),
          },
        });
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

const channelCache = new Map<string, WorkspaceChannel[]>();
const channelEventCache = new Map<string, ChannelEvent[]>();

/**
 * Last-known transcripts keyed by `workspaceId:chatId`. Retained across chat
 * switches so returning to a channel renders its content immediately instead of
 * flashing an empty frame while history reloads; the server snapshot replaces
 * it moments later.
 */
const chatTranscriptCache = new Map<string, ChiefUIMessage[]>();

/** Durable NIP-29 events for channel timelines and message search. */
export function useChannelEvents(channelId: string | null) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const cacheKey =
    cloudOrganizationId && channelId
      ? `${cloudOrganizationId}\0${channelId}`
      : null;
  const [eventState, setEventState] = useState<{
    cacheKey: string | null;
    events: ChannelEvent[];
    loaded: boolean;
  }>(() => ({
    cacheKey,
    events: cacheKey ? (channelEventCache.get(cacheKey) ?? []) : [],
    loaded: cacheKey ? channelEventCache.has(cacheKey) : true,
  }));
  const events =
    eventState.cacheKey === cacheKey
      ? eventState.events
      : cacheKey
        ? (channelEventCache.get(cacheKey) ?? [])
        : [];
  const eventsLoaded =
    eventState.cacheKey === cacheKey ? eventState.loaded : false;

  useEffect(() => {
    if (
      !cloudOrganizationId ||
      !channelId ||
      !capability ||
      status !== "connected"
    ) {
      return;
    }
    const activeCacheKey = `${cloudOrganizationId}\0${channelId}`;
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type === "channelEvents" &&
        message.workspaceId === cloudOrganizationId &&
        message.channelId === channelId
      ) {
        channelEventCache.set(activeCacheKey, message.events);
        setEventState({
          cacheKey: activeCacheKey,
          events: message.events,
          loaded: true,
        });
        return;
      }
      if (
        message.type === "channelEvent" &&
        message.workspaceId === cloudOrganizationId &&
        message.event.channelId === channelId
      ) {
        setEventState((currentState) => {
          const current =
            currentState.cacheKey === activeCacheKey
              ? currentState.events
              : (channelEventCache.get(activeCacheKey) ?? []);
          if (current.some((event) => event.id === message.event.id)) {
            return {
              cacheKey: activeCacheKey,
              events: current,
              loaded: currentState.loaded,
            };
          }
          const next = [...current, message.event];
          channelEventCache.set(activeCacheKey, next);
          return {
            cacheKey: activeCacheKey,
            events: next,
            loaded: true,
          };
        });
      }
    });
    client.send({
      type: "listChannelEvents",
      workspaceId: cloudOrganizationId,
      channelId,
      executorCapability: capability,
    });
    return () => {
      unsubscribe();
    };
  }, [cacheKey, capability, channelId, client, cloudOrganizationId, status]);

  return { events, loaded: eventsLoaded };
}

/** Durable NIP-29 destinations, including user-created workspace channels. */
export function useWorkspaceChannels() {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const { sessionToken } = useAuth();
  const pendingCreates = useRef(
    new Map<
      string,
      {
        resolve: (channelId: string | null) => void;
        timeout: number;
      }
    >(),
  );
  const pendingDeletes = useRef(
    new Map<
      string,
      {
        reject: (error: Error) => void;
        resolve: () => void;
        timeout: number;
      }
    >(),
  );
  const pendingUpdates = useRef(
    new Map<
      string,
      {
        reject: (error: Error) => void;
        resolve: () => void;
        timeout: number;
      }
    >(),
  );
  const [channels, setChannels] = useState<WorkspaceChannel[]>(() =>
    cloudOrganizationId ? (channelCache.get(cloudOrganizationId) ?? []) : [],
  );

  useEffect(() => {
    if (!cloudOrganizationId || !capability || status !== "connected") return;
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type === "channels" &&
        message.workspaceId === cloudOrganizationId
      ) {
        channelCache.set(cloudOrganizationId, message.channels);
        setChannels(message.channels);
      }
      if (
        message.type === "channelCreated" &&
        message.workspaceId === cloudOrganizationId
      ) {
        setChannels((current) => {
          const next = current.some(
            (channel) => channel.id === message.channel.id,
          )
            ? current
            : [...current, message.channel];
          channelCache.set(cloudOrganizationId, next);
          return next;
        });
        const pending = pendingCreates.current.get(message.requestId);
        if (pending) {
          window.clearTimeout(pending.timeout);
          pendingCreates.current.delete(message.requestId);
          pending.resolve(message.channel.id);
        }
      }
      if (
        message.type === "channelUpdated" &&
        message.workspaceId === cloudOrganizationId
      ) {
        setChannels((current) => {
          const next = current.map((channel) =>
            channel.id === message.channel.id ? message.channel : channel,
          );
          channelCache.set(cloudOrganizationId, next);
          return next;
        });
        const pending = pendingUpdates.current.get(message.requestId);
        if (pending) {
          window.clearTimeout(pending.timeout);
          pendingUpdates.current.delete(message.requestId);
          pending.resolve();
        }
      }
      if (
        message.type === "channelUpdateFailed" &&
        message.workspaceId === cloudOrganizationId
      ) {
        const pending = pendingUpdates.current.get(message.requestId);
        if (pending) {
          window.clearTimeout(pending.timeout);
          pendingUpdates.current.delete(message.requestId);
          pending.reject(new Error(message.message));
        }
      }
      if (
        message.type === "channelDeleted" &&
        message.workspaceId === cloudOrganizationId
      ) {
        setChannels((current) => {
          const next = current.filter(
            (channel) => channel.id !== message.channelId,
          );
          channelCache.set(cloudOrganizationId, next);
          return next;
        });
        const pending = pendingDeletes.current.get(message.requestId);
        if (pending) {
          window.clearTimeout(pending.timeout);
          pendingDeletes.current.delete(message.requestId);
          pending.resolve();
        }
      }
      if (
        message.type === "channelDeleteFailed" &&
        message.workspaceId === cloudOrganizationId
      ) {
        const pending = pendingDeletes.current.get(message.requestId);
        if (pending) {
          window.clearTimeout(pending.timeout);
          pendingDeletes.current.delete(message.requestId);
          pending.reject(new Error(message.message));
        }
      }
    });
    client.send({
      type: "listChannels",
      workspaceId: cloudOrganizationId,
      executorCapability: capability,
    });
    return () => {
      unsubscribe();
    };
  }, [capability, client, cloudOrganizationId, status]);

  const createChannel = useCallback(
    (name: string, description?: string): Promise<string | null> => {
      if (!cloudOrganizationId || !capability) return Promise.resolve(null);
      const requestId = crypto.randomUUID();
      return new Promise((resolve) => {
        const timeout = window.setTimeout(() => {
          pendingCreates.current.delete(requestId);
          resolve(null);
          toast.error("Chief couldn't create that channel. Please try again.");
        }, 8_000);
        pendingCreates.current.set(requestId, { resolve, timeout });
        client.send({
          type: "createChannel",
          requestId,
          workspaceId: cloudOrganizationId,
          name,
          description,
          executorCapability: capability,
        });
      });
    },
    [capability, client, cloudOrganizationId],
  );

  const updateChannelAgents = useCallback(
    (channelId: string, agentIds: string[]) => {
      if (!cloudOrganizationId || !capability) return;
      setChannels((current) => {
        const next = current.map((channel) =>
          channel.id === channelId
            ? { ...channel, agentIds, updatedAt: Date.now() }
            : channel,
        );
        channelCache.set(cloudOrganizationId, next);
        return next;
      });
      client.send({
        type: "updateChannelAgents",
        workspaceId: cloudOrganizationId,
        channelId,
        agentIds,
        executorCapability: capability,
      });
    },
    [capability, client, cloudOrganizationId],
  );

  const updateChannel = useCallback(
    (
      channelId: string,
      input: { name: string; topic: string; description: string },
    ): Promise<void> => {
      if (!cloudOrganizationId || !capability || !sessionToken) {
        return Promise.reject(
          new Error("Chief is still authorizing this workspace."),
        );
      }
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          pendingUpdates.current.delete(requestId);
          reject(
            new Error("Chief couldn't update that channel. Please try again."),
          );
        }, 8_000);
        pendingUpdates.current.set(requestId, { reject, resolve, timeout });
        client.send({
          type: "updateChannel",
          requestId,
          workspaceId: cloudOrganizationId,
          channelId,
          name: input.name,
          topic: input.topic,
          description: input.description,
          sessionToken,
          executorCapability: capability,
        });
      });
    },
    [capability, client, cloudOrganizationId, sessionToken],
  );

  const deleteChannel = useCallback(
    (channelId: string): Promise<void> => {
      if (!cloudOrganizationId || !capability || !sessionToken) {
        return Promise.reject(
          new Error("Chief is still connecting to this workspace."),
        );
      }
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          pendingDeletes.current.delete(requestId);
          reject(
            new Error("Chief couldn't delete that channel. Please try again."),
          );
        }, 8_000);
        pendingDeletes.current.set(requestId, { reject, resolve, timeout });
        client.send({
          type: "deleteChannel",
          requestId,
          workspaceId: cloudOrganizationId,
          channelId,
          sessionToken,
          executorCapability: capability,
        });
      });
    },
    [capability, client, cloudOrganizationId, sessionToken],
  );

  return {
    channels,
    createChannel,
    deleteChannel,
    updateChannel,
    updateChannelAgents,
  };
}

function reactionIntentKey(messageId: string, emoji: string) {
  return `${messageId}\0${emoji}`;
}

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

export function useProviderModels(driver: DriverType | null) {
  const { client, status } = useRuntime();
  // Cached across mounts and runtime reconnects: the picker renders the last
  // known list immediately and refreshes in place.
  const [models, setModels] = useState<ProviderModelOption[]>(() =>
    driver ? (providerModelsCache.get(driver) ?? []) : [],
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const cached = driver ? providerModelsCache.get(driver) : undefined;
    setModels(cached ?? []);
    if (!driver || status !== "connected") return;
    if (!cached) setLoading(true);
    const unsubscribe = client.subscribe((message) => {
      if (message.type === "models" && message.driver === driver) {
        providerModelsCache.set(driver, message.models);
        setModels(message.models);
        setLoading(false);
      }
    });
    client.send({ type: "listModels", driver });
    return () => {
      unsubscribe();
    };
  }, [client, driver, status]);

  return { models, loading };
}

const workspaceDataCache = new Map<string, WorkspaceDataState>();

function onboardingJobsStorageKey(workspaceId: string) {
  return `chief:onboarding-work:${workspaceId}`;
}

function readOnboardingJobs(workspaceId: string) {
  return window.localStorage.getItem(onboardingJobsStorageKey(workspaceId));
}

export function updatePendingOnboardingDriver(
  workspaceId: string,
  driver: DriverType,
  model: string | null,
) {
  const stored = readOnboardingJobs(workspaceId);
  if (!stored) return false;
  try {
    const pending = JSON.parse(stored) as Record<string, unknown>;
    window.localStorage.setItem(
      onboardingJobsStorageKey(workspaceId),
      JSON.stringify({ ...pending, driver, model }),
    );
    return true;
  } catch {
    return false;
  }
}

function useWorkspaceDataSource(workspaceId: string | null) {
  const { client, status } = useRuntime();
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
      ? (workspaceDataCache.get(workspaceId) ?? emptyWorkspaceData)
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
      setData(cached ?? emptyWorkspaceData);
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
      const stored = readOnboardingJobs(workspaceId);
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
        window.localStorage.removeItem(onboardingJobsStorageKey(workspaceId));
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
        const next = normalizeWorkspaceData(message);
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
        window.localStorage.removeItem(onboardingJobsStorageKey(workspaceId));
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
          onboardingJobsStorageKey(workspaceId),
          JSON.stringify({ jobs, schedules, workspaceContext, driver, model }),
        );
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
            window.localStorage.removeItem(
              onboardingJobsStorageKey(workspaceId),
            );
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

const workspaceFilesCache = new Map<string, WorkspaceFileRecord[]>();
const workspaceFileCache = new Map<string, WorkspaceFileSnapshot>();

function workspaceFileCacheKey(workspaceId: string, fileId: string) {
  return `${workspaceId}\0${fileId}`;
}

export function useWorkspaceFiles(workspaceId: string | null) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [state, setState] = useState<{
    workspaceId: string | null;
    files: WorkspaceFileRecord[];
    loaded: boolean;
  }>(() => {
    const cached = workspaceId
      ? workspaceFilesCache.get(workspaceId)
      : undefined;
    return {
      workspaceId,
      files: cached ?? [],
      loaded: Boolean(cached),
    };
  });
  const cached = workspaceId ? workspaceFilesCache.get(workspaceId) : undefined;
  const active =
    state.workspaceId === workspaceId
      ? state
      : {
          workspaceId,
          files: cached ?? [],
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
        message.type === "workspaceFiles" &&
        message.workspaceId === workspaceId
      ) {
        workspaceFilesCache.set(workspaceId, message.files);
        setState({ workspaceId, files: message.files, loaded: true });
      }
    });
    client.send({
      type: "listWorkspaceFiles",
      workspaceId,
      executorCapability: capability,
    });
    return () => {
      unsubscribe();
    };
  }, [capability, client, cloudOrganizationId, status, workspaceId]);

  return {
    files: active.files,
    loading: Boolean(workspaceId && !active.loaded),
  };
}

export function useWorkspaceFile(
  workspaceId: string | null,
  fileId: string | null,
) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const key =
    workspaceId && fileId ? workspaceFileCacheKey(workspaceId, fileId) : null;
  interface WorkspaceFileState {
    key: string | null;
    file: WorkspaceFileSnapshot | null;
    loading: boolean;
    saving: boolean;
    error: string | null;
  }
  const [state, setState] = useState<WorkspaceFileState>(() => {
    const cached = key ? workspaceFileCache.get(key) : undefined;
    return {
      key,
      file: cached ?? null,
      loading: Boolean(key && !cached),
      saving: false,
      error: null,
    };
  });
  const cached = key ? workspaceFileCache.get(key) : undefined;
  const active: WorkspaceFileState =
    state.key === key
      ? state
      : {
          key,
          file: cached ?? null,
          loading: Boolean(key && !cached),
          saving: false,
          error: null,
        };
  const pendingRequestRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      !workspaceId ||
      !fileId ||
      workspaceId !== cloudOrganizationId ||
      !capability ||
      status !== "connected"
    ) {
      return;
    }
    const requestId = crypto.randomUUID();
    pendingRequestRef.current = requestId;
    const unsubscribe = client.subscribe((message) => {
      if (
        (message.type === "workspaceFile" ||
          message.type === "workspaceFileSaved") &&
        message.workspaceId === workspaceId &&
        message.file.id === fileId
      ) {
        const cacheKey = workspaceFileCacheKey(workspaceId, fileId);
        workspaceFileCache.set(cacheKey, message.file);
        setState({
          key: cacheKey,
          file: message.file,
          loading: false,
          saving: false,
          error: null,
        });
      }
      if (
        message.type === "error" &&
        message.requestId &&
        message.requestId === pendingRequestRef.current
      ) {
        const latestCached = key ? workspaceFileCache.get(key) : undefined;
        setState((current) => ({
          ...(current.key === key
            ? current
            : {
                key,
                file: latestCached ?? null,
                loading: false,
                saving: false,
                error: null,
              }),
          key,
          saving: false,
          loading: false,
          error:
            message.message === "FILE_VERSION_CONFLICT"
              ? "This file changed since you opened it. Reload before saving your edits."
              : message.message,
        }));
      }
    });
    client.send({
      type: "getWorkspaceFile",
      workspaceId,
      fileId,
      requestId,
      executorCapability: capability,
    });
    return () => {
      unsubscribe();
    };
  }, [
    capability,
    client,
    cloudOrganizationId,
    fileId,
    key,
    status,
    workspaceId,
  ]);

  const save = (content: string, name?: string) => {
    if (
      !workspaceId ||
      !active.file ||
      workspaceId !== cloudOrganizationId ||
      !capability
    ) {
      return;
    }
    const requestId = crypto.randomUUID();
    pendingRequestRef.current = requestId;
    setState({ ...active, key, saving: true, error: null });
    const requestedName = name?.trim();
    const nextName =
      requestedName && requestedName.length > 0
        ? requestedName
        : active.file.name;
    client.send({
      type: "saveWorkspaceFile",
      workspaceId,
      requestId,
      file: {
        id: active.file.id,
        name: nextName,
        path: active.file.path,
        mimeType: active.file.mimeType,
        kind: active.file.kind,
        content,
        expectedVersionId: active.file.currentVersionId,
        createdBy: "user",
        sourceAgentId: active.file.sourceAgentId,
        sourceSessionId: active.file.sourceSessionId,
      },
      executorCapability: capability,
    });
  };

  return { ...active, save };
}

interface EmailPreview {
  html: string;
  text: string;
  versionId: string;
}

const emailPreviewCache = new Map<string, EmailPreview>();

export function useWorkspaceEmailPreview(
  workspaceId: string | null,
  file: WorkspaceFileSnapshot | null,
) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const cacheKey =
    workspaceId && file
      ? `${workspaceId}\0${file.id}\0${file.currentVersionId}`
      : null;
  interface EmailPreviewState {
    key: string | null;
    preview: EmailPreview | null;
    loading: boolean;
    error: string | null;
  }
  const [state, setState] = useState<EmailPreviewState>(() => {
    const cached = cacheKey ? emailPreviewCache.get(cacheKey) : undefined;
    return {
      key: cacheKey,
      preview: cached ?? null,
      loading: Boolean(cacheKey && !cached),
      error: null,
    };
  });
  const cached = cacheKey ? emailPreviewCache.get(cacheKey) : undefined;
  const active: EmailPreviewState =
    state.key === cacheKey
      ? state
      : {
          key: cacheKey,
          preview: cached ?? null,
          loading: Boolean(cacheKey && !cached),
          error: null,
        };

  useEffect(() => {
    const nextKey =
      workspaceId && file
        ? `${workspaceId}\0${file.id}\0${file.currentVersionId}`
        : null;
    const previewCached = nextKey ? emailPreviewCache.get(nextKey) : undefined;
    if (
      !nextKey ||
      !workspaceId ||
      file?.kind !== "email" ||
      workspaceId !== cloudOrganizationId ||
      !capability ||
      status !== "connected" ||
      previewCached
    ) {
      return;
    }
    const requestId = crypto.randomUUID();
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type === "workspaceEmailPreview" &&
        message.requestId === requestId
      ) {
        const next = {
          html: message.html,
          text: message.text,
          versionId: message.versionId,
        };
        emailPreviewCache.set(nextKey, next);
        setState({
          key: nextKey,
          preview: next,
          loading: false,
          error: null,
        });
      }
      if (message.type === "error" && message.requestId === requestId) {
        setState({
          key: nextKey,
          preview: null,
          loading: false,
          error: message.message,
        });
      }
    });
    client.send({
      type: "renderWorkspaceEmail",
      workspaceId,
      fileId: file.id,
      requestId,
      executorCapability: capability,
    });
    return () => {
      unsubscribe();
    };
  }, [capability, client, cloudOrganizationId, file, status, workspaceId]);

  return active;
}

const preferencesCache = new Map<string, AgentPreference[]>();

export function useAgentPreferences(workspaceId: string | null) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [preferences, setPreferences] = useState<AgentPreference[]>(() =>
    workspaceId ? (preferencesCache.get(workspaceId) ?? []) : [],
  );
  const [loading, setLoading] = useState(
    () => !(workspaceId && preferencesCache.has(workspaceId)),
  );
  const preferencesWorkspaceRef = useRef<string | null>(workspaceId);

  useEffect(() => {
    if (preferencesWorkspaceRef.current !== workspaceId) {
      preferencesWorkspaceRef.current = workspaceId;
      const cached = workspaceId
        ? preferencesCache.get(workspaceId)
        : undefined;
      setPreferences(cached ?? []);
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
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type === "agentPreferences" &&
        message.workspaceId === workspaceId
      ) {
        preferencesCache.set(workspaceId, message.preferences);
        setPreferences(message.preferences);
        setLoading(false);
      }
    });
    client.send({
      type: "listAgentPreferences",
      workspaceId,
      executorCapability: capability,
    });
    return () => {
      unsubscribe();
    };
  }, [capability, client, cloudOrganizationId, status, workspaceId]);

  const save = (preference: AgentPreference) => {
    if (!workspaceId || workspaceId !== cloudOrganizationId || !capability) {
      return;
    }
    setPreferences((current) => {
      const next = [
        preference,
        ...current.filter((item) => item.agentId !== preference.agentId),
      ];
      preferencesCache.set(workspaceId, next);
      return next;
    });
    client.send({
      type: "saveAgentPreference",
      workspaceId,
      preference,
      executorCapability: capability,
    });
  };

  return { preferences, loading, save };
}

/**
 * Which required secret keys already exist on this machine, and a way to
 * store new ones, with no agent session involved. Used to gate Connect
 * buttons behind credential collection for integrations that are known to
 * need values only the user can provide.
 */
export function useStoredInputs(keys: string[] | null) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [present, setPresent] = useState<ReadonlySet<string> | null>(null);
  const keysSignature = JSON.stringify(keys ?? []);

  useEffect(() => {
    const parsed = JSON.parse(keysSignature) as string[];
    setPresent(null);
    if (
      parsed.length === 0 ||
      status !== "connected" ||
      !cloudOrganizationId ||
      !capability
    ) {
      return;
    }
    const unsub = client.subscribe((msg) => {
      if (
        msg.type === "inputsStatus" &&
        msg.workspaceId === cloudOrganizationId
      ) {
        setPresent(new Set(msg.present.filter((key) => parsed.includes(key))));
      }
    });
    client.send({
      type: "queryInputs",
      workspaceId: cloudOrganizationId,
      keys: parsed,
      executorCapability: capability,
    });
    return () => {
      unsub();
    };
  }, [client, status, keysSignature, cloudOrganizationId, capability]);

  const store = (request: InputRequest, values: Record<string, string>) => {
    if (!cloudOrganizationId || !capability) return;
    client.send({
      type: "storeInput",
      workspaceId: cloudOrganizationId,
      request,
      values,
      executorCapability: capability,
    });
  };

  return { present, store };
}

export function useWorkspaceEnvironmentVariables() {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [requestAttempt, setRequestAttempt] = useState(0);
  const [variableState, setVariableState] = useState<{
    workspaceId: string;
    variables: WorkspaceEnvironmentVariable[];
  } | null>(null);
  const [errorState, setErrorState] = useState<{
    workspaceId: string;
    message: string;
  } | null>(null);
  const variables =
    variableState?.workspaceId === cloudOrganizationId
      ? variableState.variables
      : null;
  const error =
    errorState?.workspaceId === cloudOrganizationId ? errorState.message : null;

  useEffect(() => {
    if (status !== "connected" || !cloudOrganizationId || !capability) {
      return;
    }
    let resolved = false;
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type === "workspaceEnvironmentVariables" &&
        message.workspaceId === cloudOrganizationId
      ) {
        resolved = true;
        setVariableState({
          workspaceId: message.workspaceId,
          variables: message.variables,
        });
        setErrorState(null);
      }
    });
    const requestVariables = () => {
      client.send({
        type: "listWorkspaceEnvironmentVariables",
        workspaceId: cloudOrganizationId,
        executorCapability: capability,
      });
    };
    requestVariables();
    const retryTimer = window.setTimeout(() => {
      if (!resolved) requestVariables();
    }, 1_500);
    const timeoutTimer = window.setTimeout(() => {
      if (resolved) return;
      setErrorState({
        workspaceId: cloudOrganizationId,
        message: "Chief could not reach the local credential vault.",
      });
    }, 6_000);
    return () => {
      window.clearTimeout(retryTimer);
      window.clearTimeout(timeoutTimer);
      unsubscribe();
    };
  }, [capability, client, cloudOrganizationId, requestAttempt, status]);

  const save = (key: string, value: string) => {
    if (!cloudOrganizationId || !capability) return;
    client.send({
      type: "saveWorkspaceEnvironmentVariable",
      workspaceId: cloudOrganizationId,
      key,
      value,
      executorCapability: capability,
    });
  };

  const remove = (key: string) => {
    if (!cloudOrganizationId || !capability) return;
    client.send({
      type: "deleteWorkspaceEnvironmentVariable",
      workspaceId: cloudOrganizationId,
      key,
      executorCapability: capability,
    });
  };

  const refresh = () => {
    setErrorState(null);
    setRequestAttempt((attempt) => attempt + 1);
  };

  return {
    variables,
    error,
    refresh,
    save,
    remove,
    connected: status === "connected",
  };
}

export function useDisconnectGoogleAnalytics() {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();

  return () =>
    new Promise<void>((resolve, reject) => {
      if (status !== "connected" || !cloudOrganizationId || !capability) {
        reject(new Error("The local integration service is unavailable."));
        return;
      }
      const requestId = crypto.randomUUID();
      const timeout = window.setTimeout(() => {
        unsubscribe();
        reject(new Error("Disconnecting Google Analytics timed out."));
      }, 15_000);
      const unsubscribe = client.subscribe((message) => {
        if (
          message.type === "integrationDisconnected" &&
          message.workspaceId === cloudOrganizationId &&
          message.requestId === requestId
        ) {
          window.clearTimeout(timeout);
          unsubscribe();
          resolve();
          return;
        }
        if (message.type === "error" && message.requestId === requestId) {
          window.clearTimeout(timeout);
          unsubscribe();
          reject(new Error(message.message));
        }
      });
      client.send({
        type: "disconnectGoogleAnalytics",
        workspaceId: cloudOrganizationId,
        requestId,
        executorCapability: capability,
      });
    });
}

// ---- Chat state ----

export interface PendingApproval {
  requestId: string;
  toolName: string;
  input: unknown;
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
  const pendingMessageContextRef = useRef<
    | {
        threadRootId?: string;
        mentions?: string[];
      }
    | undefined
  >(undefined);
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
            threadRootId:
              message.metadata?.threadRootId ??
              pendingMessageContextRef.current?.threadRootId,
            mentions:
              message.metadata?.mentions ??
              pendingMessageContextRef.current?.mentions,
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
            senderName: senderName?.length ? senderName : "You",
            execution: executionRef.current,
            executorCapability,
          });
          pendingMessageContextRef.current = undefined;
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
      context?: { threadRootId?: string; mentions?: string[] },
      attachments?: MessageAttachment[],
    ) => {
      pendingMessageContextRef.current = context;
      void sendMessage({
        text,
        metadata: {
          createdAt: Date.now(),
          ...(context?.threadRootId
            ? { threadRootId: context.threadRootId }
            : {}),
          ...(context?.mentions?.length ? { mentions: context.mentions } : {}),
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
    if (!channelId || channelEvents.length === 0) {
      return dropReplayedMessages(messages);
    }

    const sourceIdsByEventId = new Map(
      channelEvents.flatMap((event) => {
        const sourceId = channelEventSourceId(event);
        return sourceId ? [[event.id, sourceId] as const] : [];
      }),
    );
    // Channel events are the authoritative source for thread placement. On a
    // reconnect, a transcript message can arrive before its channel event and
    // lack the thread metadata in the client buffer. Enrich it from the event
    // tags before rendering, otherwise the same thread reply leaks into the
    // top-level timeline after navigating away and back.
    const directById = new Map(
      messages.map((message) => [message.id, message]),
    );
    const seenIds = new Set<string>();
    const canonicalMessages: ChiefUIMessage[] = [];
    for (const event of channelEvents) {
      if (event.kind !== 9 || !event.content.trim()) continue;
      const id = channelEventSourceId(event) ?? event.id;
      if (id.endsWith("-welcome") || seenIds.has(id)) continue;
      const direct = directById.get(id);
      const protocolRootId = channelEventThreadRootId(event);
      const threadRootId = protocolRootId
        ? (sourceIdsByEventId.get(protocolRootId) ?? protocolRootId)
        : direct?.metadata?.threadRootId;
      // Preserve message identity when the enrichment changes nothing, so
      // React can skip re-rendering unchanged rows instead of rebuilding the
      // whole thread on every event (that rebuild is what made threads flicker).
      const needsEnrichment =
        !direct ||
        Boolean(
          threadRootId && threadRootId !== direct.metadata?.threadRootId,
        ) ||
        Boolean(direct.metadata && !direct.metadata.createdAt);
      canonicalMessages.push(
        !needsEnrichment
          ? direct
          : direct
            ? {
                ...direct,
                metadata: {
                  ...direct.metadata,
                  createdAt: direct.metadata?.createdAt ?? event.createdAt,
                  ...(threadRootId ? { threadRootId } : {}),
                },
              }
            : {
                id,
                role: event.actor.type === "user" ? "user" : "assistant",
                parts: [{ type: "text", text: event.content }],
                metadata: {
                  createdAt: event.createdAt,
                  ...(threadRootId ? { threadRootId } : {}),
                },
              },
      );
      seenIds.add(id);
    }
    // Keep live transcript messages that do not have a channel event yet — an
    // optimistic user send or a streaming assistant reply must appear the moment
    // it is created, not only after its mirror event lands. dropReplayedMessages
    // removes restart-replay copies so these are never confused with duplicates.
    for (const message of messages) {
      if (seenIds.has(message.id)) continue;
      canonicalMessages.push(message);
      seenIds.add(message.id);
    }
    return dropReplayedMessages(
      canonicalMessages.sort(
        (left, right) =>
          (left.metadata?.createdAt ?? 0) - (right.metadata?.createdAt ?? 0),
      ),
    );
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

/** A user-composable top-level Chief chat with a per-conversation backend. */
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
