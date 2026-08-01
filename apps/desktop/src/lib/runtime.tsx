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
  ActionItem,
  AgentDefinition,
  AgentEvent,
  AgentPreference,
  AgentQuestion,
  AnalyticsDataset,
  CampaignRecord,
  ChatExecutionSelection,
  ChiefUIMessage,
  ClientMessage,
  ContentBlock,
  ContentDraftRecord,
  DiagnosticEventRecord,
  DriverType,
  ExecutorCapability,
  InputRequest,
  IntegrationSetupProgress,
  OnboardingSchedule,
  OnboardingWorkJob,
  ProspectRecord,
  ProviderModelOption,
  RecurringWorkRecord,
  ServerMessage,
  SessionRecord,
  TrendRecord,
  WorkspaceChannel,
  WorkspaceEnvironmentVariable,
  WorkspaceFileRecord,
  WorkspaceFileSnapshot,
} from "@chief/agent-runtime/types";
import { api } from "@chief/backend/convex/_generated/api";

import { useAuth } from "./auth/auth-context";
import { navigateApp, notifySystem } from "./notifications";
import {
  deduplicateDocumentParts,
  mergeRuntimeMessage,
} from "./runtime-messages";
import { buildWorkspaceContext } from "./workspace-context";

// "localhost" (not 127.0.0.1) — macOS ATS only exempts the literal
// localhost hostname for insecure websockets inside WKWebView.
const RUNTIME_URL = "ws://localhost:4318";
const EXECUTOR_CAPABILITY_PREFIX = "chief:executor-capability:";
const workspaceCapabilityCache = new Map<string, ExecutorCapability>();
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
      return;
    }

    let cancelled = false;
    let retryTimer: number | undefined;
    setCapability(null);
    setError(null);
    const token = workspaceCapabilityToken(cloudOrganizationId);
    void registerCapability({ token })
      .then(({ apiBaseUrl }) => {
        if (cancelled) return;
        const next = { apiBaseUrl, token };
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
  onStatus: (status: RuntimeStatus) => void = () => {};

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
    this.onStatus("connecting");
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
      this.onStatus("connected");
      for (const msg of this.queue.splice(0)) this.send(msg);
    };
    socket.onmessage = (e) => {
      try {
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
    this.onStatus("connecting");
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

interface RuntimeContextValue {
  client: RuntimeClient;
  status: RuntimeStatus;
  agents: AgentDefinition[];
  browserUrl: string | null;
  browserStreamUrl: string | null;
  browserConversationId: string | null;
  browserWorkspaceId: string | null;
  integrationSetupProgress: Readonly<Record<string, IntegrationSetupProgress>>;
  openBrowser: (url: string, conversationId?: string) => void;
  reportBrowserUrl: (url: string) => void;
  reloadBrowser: () => void;
  resizeBrowser: (width: number, height: number) => void;
  takeBrowserControl: () => void;
  closeBrowser: () => void;
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const { cloudOrganizationId } = useAuth();
  const markIntegrationConnected = useMutation(api.integrations.markConnected);
  const clientRef = useRef<RuntimeClient | null>(null);
  if (!clientRef.current) clientRef.current = new RuntimeClient();
  const client = clientRef.current;

  const [status, setStatus] = useState<RuntimeStatus>("connecting");
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);
  const [browserStreamUrl, setBrowserStreamUrl] = useState<string | null>(null);
  const [browserConversationId, setBrowserConversationId] = useState<
    string | null
  >(null);
  const [browserWorkspaceId, setBrowserWorkspaceId] = useState<string | null>(
    null,
  );
  const browserViewportRef = useRef<{ width: number; height: number } | null>(
    null,
  );
  const browserOwnerRef = useRef<{
    workspaceId: string;
    conversationId: string;
  } | null>(null);
  const pendingBrowserNavigationRef = useRef<{
    workspaceId: string;
    conversationId: string;
    url: string;
  } | null>(null);
  const browserResizeTimerRef = useRef<number | null>(null);
  const pendingBrowserResizeRef = useRef<{
    workspaceId: string;
    conversationId: string;
    width: number;
    height: number;
  } | null>(null);
  const browserResizeSentAtRef = useRef(0);
  const [setupProgressState, setSetupProgressState] = useState<{
    workspaceId: string;
    byConversation: Record<string, IntegrationSetupProgress>;
  } | null>(null);
  const integrationSetupProgress =
    setupProgressState?.workspaceId === cloudOrganizationId
      ? setupProgressState.byConversation
      : EMPTY_SETUP_PROGRESS;
  const openBrowser = useCallback(
    (url: string, conversationId?: string) => {
      setBrowserUrl(url);
      setBrowserStreamUrl(null);
      setBrowserWorkspaceId(cloudOrganizationId);
      const owningConversation = conversationId ?? browserConversationId;
      if (owningConversation) {
        setBrowserConversationId(owningConversation);
        if (cloudOrganizationId) {
          const pending = {
            workspaceId: cloudOrganizationId,
            conversationId: owningConversation,
            url,
          };
          browserOwnerRef.current = pending;
          pendingBrowserNavigationRef.current = pending;
          const viewport = browserViewportRef.current;
          if (viewport) {
            client.send({
              type: "browserNavigateRequest",
              ...pending,
              ...viewport,
            });
            pendingBrowserNavigationRef.current = null;
          }
        }
      }
    },
    [browserConversationId, client, cloudOrganizationId],
  );
  const reloadBrowser = useCallback(() => {
    if (!browserWorkspaceId || !browserConversationId) return;
    client.send({
      type: "browserReload",
      workspaceId: browserWorkspaceId,
      conversationId: browserConversationId,
    });
  }, [browserConversationId, browserWorkspaceId, client]);
  const reportBrowserUrl = useCallback(
    (url: string) => {
      if (!browserWorkspaceId || !browserConversationId) return;
      setBrowserUrl(url);
      client.send({
        type: "browserUrlChanged",
        workspaceId: browserWorkspaceId,
        conversationId: browserConversationId,
        url,
      });
    },
    [browserConversationId, browserWorkspaceId, client],
  );
  const flushBrowserResize = useCallback(() => {
    browserResizeTimerRef.current = null;
    const pending = pendingBrowserResizeRef.current;
    if (!pending) return;
    pendingBrowserResizeRef.current = null;
    browserResizeSentAtRef.current = Date.now();
    client.send({ type: "browserViewportResize", ...pending });
  }, [client]);
  const resizeBrowser = useCallback(
    (width: number, height: number) => {
      const viewport = { width, height };
      browserViewportRef.current = viewport;
      const pending = pendingBrowserNavigationRef.current;
      if (pending) {
        pendingBrowserNavigationRef.current = null;
        client.send({
          type: "browserNavigateRequest",
          ...pending,
          ...viewport,
        });
        return;
      }
      if (!browserWorkspaceId || !browserConversationId) return;
      pendingBrowserResizeRef.current = {
        workspaceId: browserWorkspaceId,
        conversationId: browserConversationId,
        width,
        height,
      };
      if (browserResizeTimerRef.current !== null) return;
      const wait = Math.max(
        0,
        50 - (Date.now() - browserResizeSentAtRef.current),
      );
      if (wait === 0) flushBrowserResize();
      else {
        browserResizeTimerRef.current = window.setTimeout(
          flushBrowserResize,
          wait,
        );
      }
    },
    [browserConversationId, browserWorkspaceId, client, flushBrowserResize],
  );
  const resetBrowser = useCallback(() => {
    if (browserResizeTimerRef.current !== null) {
      window.clearTimeout(browserResizeTimerRef.current);
      browserResizeTimerRef.current = null;
    }
    browserViewportRef.current = null;
    pendingBrowserNavigationRef.current = null;
    pendingBrowserResizeRef.current = null;
    browserResizeSentAtRef.current = 0;
    browserOwnerRef.current = null;
    setBrowserUrl(null);
    setBrowserStreamUrl(null);
    setBrowserConversationId(null);
    setBrowserWorkspaceId(null);
  }, []);
  const closeBrowser = useCallback(() => {
    const owner = browserOwnerRef.current;
    if (owner) {
      client.send({
        type: "browserClose",
        ...owner,
      });
    }
    resetBrowser();
  }, [client, resetBrowser]);
  const takeBrowserControl = useCallback(() => {
    if (!browserWorkspaceId || !browserConversationId) return;
    const executorCapability = workspaceCapabilityCache.get(browserWorkspaceId);
    if (!executorCapability) return;
    client.send({
      type: "interruptChat",
      workspaceId: browserWorkspaceId,
      chatId: browserConversationId,
      executorCapability,
    });
  }, [browserConversationId, browserWorkspaceId, client]);

  useEffect(() => {
    client.onStatus = (s) => {
      setStatus(s);
      if (s === "connected") client.send({ type: "listAgents" });
    };
    const unsub = client.subscribe((msg) => {
      if (msg.type === "agents") setAgents(msg.agents);
      if (
        (msg.type === "browserPrepare" || msg.type === "browserNavigate") &&
        msg.workspaceId === cloudOrganizationId
      ) {
        setBrowserUrl(msg.url);
        setBrowserStreamUrl(
          msg.type === "browserNavigate" ? msg.streamUrl : null,
        );
        browserOwnerRef.current = {
          workspaceId: msg.workspaceId,
          conversationId: msg.conversationId,
        };
        setBrowserWorkspaceId(msg.workspaceId);
        setBrowserConversationId(msg.conversationId);
        navigateApp(
          `/conversations?chat=${encodeURIComponent(msg.conversationId)}`,
        );
      }
      const browserOwner = browserOwnerRef.current;
      if (
        msg.type === "browserClosed" &&
        msg.workspaceId === cloudOrganizationId &&
        browserOwner !== null &&
        msg.workspaceId === browserOwner.workspaceId &&
        msg.conversationId === browserOwner.conversationId
      ) {
        resetBrowser();
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
        closeBrowser();
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
        const isWorkNotice =
          msg.notice.kind === "work-started" ||
          msg.notice.kind === "work-completed";
        const route = isWorkNotice ? "/schedule" : "/";
        toast(msg.notice.title, {
          description: msg.notice.detail,
          duration: 10_000,
          action: {
            label: isWorkNotice ? "View schedule" : "Review action",
            onClick: () => navigateApp(route),
          },
        });
        void notifySystem(msg.notice.title, msg.notice.detail, route);
      }
    });
    client.connect();
    return () => {
      unsub();
      client.destroy();
    };
  }, [
    client,
    closeBrowser,
    cloudOrganizationId,
    markIntegrationConnected,
    resetBrowser,
  ]);

  const value = useMemo(
    () => ({
      client,
      status,
      agents,
      browserUrl,
      browserStreamUrl,
      browserConversationId,
      browserWorkspaceId,
      integrationSetupProgress,
      openBrowser,
      reportBrowserUrl,
      reloadBrowser,
      resizeBrowser,
      takeBrowserControl,
      closeBrowser,
    }),
    [
      agents,
      browserConversationId,
      browserStreamUrl,
      browserUrl,
      browserWorkspaceId,
      client,
      closeBrowser,
      integrationSetupProgress,
      openBrowser,
      reportBrowserUrl,
      reloadBrowser,
      resizeBrowser,
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
  const [chats, setChats] = useState<LocalChatSummary[]>(
    () => (workspaceId && chatsCache.get(workspaceId)) || [],
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
      setChats((workspaceId && chatsCache.get(workspaceId)) || []);
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

/** Durable NIP-29 destinations, including user-created workspace channels. */
export function useWorkspaceChannels() {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
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
    (name: string, description?: string) => {
      if (!cloudOrganizationId || !capability) return;
      client.send({
        type: "createChannel",
        workspaceId: cloudOrganizationId,
        name,
        description,
        executorCapability: capability,
      });
    },
    [capability, client, cloudOrganizationId],
  );

  return { channels, createChannel };
}

const providerModelsCache = new Map<DriverType, ProviderModelOption[]>();

export function useProviderModels(driver: DriverType | null) {
  const { client, status } = useRuntime();
  // Cached across mounts and runtime reconnects: the picker renders the last
  // known list immediately and refreshes in place.
  const [models, setModels] = useState<ProviderModelOption[]>(
    () => (driver && providerModelsCache.get(driver)) || [],
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

interface WorkspaceDataState {
  prospects: ProspectRecord[];
  trends: TrendRecord[];
  analyticsDatasets: AnalyticsDataset[];
  drafts: ContentDraftRecord[];
  campaigns: CampaignRecord[];
  recurringWork: RecurringWorkRecord[];
  activity: SessionRecord[];
  actionItems: ActionItem[];
}

const emptyWorkspaceData: WorkspaceDataState = {
  prospects: [],
  trends: [],
  analyticsDatasets: [],
  drafts: [],
  campaigns: [],
  recurringWork: [],
  activity: [],
  actionItems: [],
};

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
  const [data, setData] = useState<WorkspaceDataState>(
    () =>
      (workspaceId && workspaceDataCache.get(workspaceId)) ||
      emptyWorkspaceData,
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
        const next = {
          prospects: message.prospects,
          trends: message.trends,
          analyticsDatasets: message.analyticsDatasets,
          drafts: message.drafts,
          campaigns: message.campaigns,
          recurringWork: message.recurringWork,
          activity: message.activity,
          actionItems: message.actionItems,
        };
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
  const [preferences, setPreferences] = useState<AgentPreference[]>(
    () => (workspaceId && preferencesCache.get(workspaceId)) || [],
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
        error: event.ok ? undefined : event.error,
      };
    case "status":
      return {
        ...controls,
        status: event.status === "running" ? "running" : "idle",
        error: event.status === "running" ? undefined : controls.error,
      };
    case "error":
      return { ...controls, error: event.message, status: "idle" };
    case "exit":
      return {
        ...controls,
        status: "idle",
        error:
          event.code && event.code !== 0
            ? `Agent process exited with code ${event.code}.`
            : controls.error,
      };
    default:
      return controls;
  }
}

export function messageBlocks(message: ChiefUIMessage): ContentBlock[] {
  return message.parts.flatMap((part): ContentBlock[] => {
    if (part.type === "text") return [{ type: "text", text: part.text }];
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
) {
  const { client, status: runtimeStatus } = useRuntime();
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
    executionRef.current = selectedExecution ?? execution ?? initialExecution;
  }, [execution, initialExecution, selectedExecution]);
  const transport = useMemo<ChatTransport<ChiefUIMessage>>(
    () => ({
      sendMessages: ({ messages }) => {
        const message = messages.at(-1);
        const text = message?.parts
          .flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("\n")
          .trim();
        if (
          mode === "open" &&
          chatId &&
          message?.role === "user" &&
          text &&
          cloudOrganizationId &&
          executorCapability
        ) {
          setControls((current) => ({
            ...current,
            status: "running",
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
            threadRootId: pendingMessageContextRef.current?.threadRootId,
            mentions: pendingMessageContextRef.current?.mentions,
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
    [chatId, client, cloudOrganizationId, executorCapability, mode],
  );
  const { messages, sendMessage, setMessages } = useChat<ChiefUIMessage>({
    id: chatId ?? "inactive-chief-chat",
    generateId: () => crypto.randomUUID(),
    transport,
  });

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
    setControls(emptyChatControls);
    pendingStreamRef.current = "";
    setMessages([]);
    setChatReady(false);
    setExecution(undefined);
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
        setMessages(deduplicateDocumentParts(msg.messages));
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
      client.send({
        type: "closeChat",
        workspaceId: cloudOrganizationId,
        chatId,
        executorCapability,
      });
      unsub();
      setChatReady(false);
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
    ) => {
      pendingMessageContextRef.current = context;
      void sendMessage({ text });
    },
    [sendMessage],
  );

  return {
    messages,
    controls,
    sendMessage,
    sendMessageWithContext,
    interrupt,
    respondPermission,
    respondQuestion,
    provideInput,
    chatReady,
    execution,
  };
}

/** A user-composable top-level Chief chat with a per-conversation backend. */
export function useChiefChat(
  chatId: string | null,
  initialExecution?: ChatExecutionSelection,
  selectedExecution?: ChatExecutionSelection,
  access?: "full" | "guarded",
  destination?: { channelId?: string; agentId?: string },
) {
  return useRuntimeChat(
    chatId,
    "open",
    initialExecution,
    selectedExecution,
    access,
    undefined,
    undefined,
    destination?.channelId,
    destination?.agentId,
  );
}

export function useIntegrationSetupChat(
  chatId: string | null,
  integrationDomain: string,
  selectedExecution?: ChatExecutionSelection,
  channelId?: string,
) {
  return useRuntimeChat(
    chatId,
    "open",
    undefined,
    selectedExecution,
    "full",
    "integration-setup",
    integrationDomain,
    channelId,
    "setup",
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
