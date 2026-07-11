import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AccessMode,
  AgentPreference,
  AgentDefinition,
  AgentEvent,
  AgentQuestion,
  AttentionItem,
  CampaignRecord,
  ClientMessage,
  ContentBlock,
  ContentDraftRecord,
  DriverType,
  ExecutorCapability,
  InputRequest,
  ProspectRecord,
  ProviderModelOption,
  RecurringWorkRecord,
  RecurringWorkRunRecord,
  ServerMessage,
  TrendRecord,
} from "@marketer/agent-runtime/types";
import { api } from "@marketer/backend/convex/_generated/api";
import { useAction } from "convex/react";
import { getAgentOverride } from "./agent-overrides";
import { useAuth } from "./auth/auth-context";
import { buildWorkspaceContext } from "./workspace-context";

// "localhost" (not 127.0.0.1) — macOS ATS only exempts the literal
// localhost hostname for insecure websockets inside WKWebView.
const RUNTIME_URL = "ws://localhost:4318";
const EXECUTOR_CAPABILITY_PREFIX = "marketer:executor-capability:";
const workspaceCapabilityCache = new Map<string, ExecutorCapability>();

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

function useWorkspaceCapability() {
  const { cloudOrganizationId } = useAuth();
  const registerCapability = useAction(api.agentTools.registerCapability);
  const [capability, setCapability] = useState<ExecutorCapability | null>(
    cloudOrganizationId
      ? (workspaceCapabilityCache.get(cloudOrganizationId) ?? null)
      : null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cloudOrganizationId) {
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
    setCapability(null);
    setError(null);
    const token = workspaceCapabilityToken(cloudOrganizationId);
    void registerCapability({ token })
      .then(({ apiBaseUrl }) => {
        if (cancelled) return;
        const next = { apiBaseUrl, token };
        workspaceCapabilityCache.set(cloudOrganizationId, next);
        setCapability(next);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not authorize this workspace.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cloudOrganizationId, registerCapability]);

  return { cloudOrganizationId, capability, error };
}

type Listener = (msg: ServerMessage) => void;

export class RuntimeClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private queue: ClientMessage[] = [];
  private closed = false;
  private reconnectTimer: number | null = null;
  private reconnectDelayMs = 5000;
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
      this.ws = new WebSocket(RUNTIME_URL);
    } catch {
      this.ws = null;
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.reconnectDelayMs = 5000;
      this.onStatus("connected");
      for (const msg of this.queue.splice(0)) this.send(msg);
    };
    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as ServerMessage;
        for (const l of this.listeners) l(msg);
      } catch {
        // ignore
      }
    };
    this.ws.onclose = () => {
      this.ws = null;
      this.onStatus("disconnected");
      this.scheduleReconnect();
    };
    this.ws.onerror = () => this.ws?.close();
  }

  private scheduleReconnect() {
    if (this.closed || this.reconnectTimer !== null) return;
    this.onStatus("disconnected");
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 1.5, 30000);
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
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<RuntimeClient | null>(null);
  if (!clientRef.current) clientRef.current = new RuntimeClient();
  const client = clientRef.current;

  const [status, setStatus] = useState<RuntimeStatus>("connecting");
  const [agents, setAgents] = useState<AgentDefinition[]>([]);

  useEffect(() => {
    client.onStatus = (s) => {
      setStatus(s);
      if (s === "connected") client.send({ type: "listAgents" });
    };
    const unsub = client.subscribe((msg) => {
      if (msg.type === "agents") setAgents(msg.agents);
    });
    client.connect();
    return () => {
      unsub();
      client.destroy();
    };
  }, [client]);

  const value = useMemo(
    () => ({ client, status, agents }),
    [client, status, agents],
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

export interface LocalChatSummary {
  id: string;
  agentId: string;
  title: string;
  lastText: string;
  lastAt: number;
  driver?: DriverType;
  model?: string;
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
  const chatsWorkspaceRef = useRef<string | null>(workspaceId);

  useEffect(() => {
    // Reset only when the workspace itself changes; a runtime reconnect or
    // capability refresh keeps the last list mounted while it revalidates.
    if (chatsWorkspaceRef.current !== workspaceId) {
      chatsWorkspaceRef.current = workspaceId;
      setChats((workspaceId && chatsCache.get(workspaceId)) || []);
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
      type: "deleteSession",
      chatId,
      workspaceId,
      executorCapability: capability,
    });
  };

  return { chats, remove };
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
  drafts: ContentDraftRecord[];
  campaigns: CampaignRecord[];
  recurringWork: RecurringWorkRecord[];
  recurringWorkRuns: RecurringWorkRunRecord[];
  attentionItems: AttentionItem[];
}

const emptyWorkspaceData: WorkspaceDataState = {
  prospects: [],
  trends: [],
  drafts: [],
  campaigns: [],
  recurringWork: [],
  recurringWorkRuns: [],
  attentionItems: [],
};

const workspaceDataCache = new Map<string, WorkspaceDataState>();

export function useWorkspaceData(workspaceId: string | null) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
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
  const dataWorkspaceRef = useRef<string | null>(workspaceId);

  useEffect(() => {
    if (dataWorkspaceRef.current !== workspaceId) {
      dataWorkspaceRef.current = workspaceId;
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
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type === "workspaceData" &&
        message.workspaceId === workspaceId
      ) {
        const next = {
          prospects: message.prospects,
          trends: message.trends,
          drafts: message.drafts,
          campaigns: message.campaigns,
          recurringWork: message.recurringWork,
          recurringWorkRuns: message.recurringWorkRuns,
          attentionItems: message.attentionItems,
        };
        workspaceDataCache.set(workspaceId, next);
        setData(next);
        setLoading(false);
      }
    });
    client.send({
      type: "listWorkspaceData",
      workspaceId,
      executorCapability: capability,
    });
    return () => {
      unsubscribe();
    };
  }, [capability, client, cloudOrganizationId, status, workspaceId]);

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

  const dismissAttentionItem = (attentionItemId: string) => {
    if (!workspaceId || workspaceId !== cloudOrganizationId || !capability) {
      return;
    }
    setData((current) => {
      const next = {
        ...current,
        attentionItems: current.attentionItems.filter(
          (item) => item.id !== attentionItemId,
        ),
      };
      workspaceDataCache.set(workspaceId, next);
      return next;
    });
    client.send({
      type: "dismissAttentionItem",
      workspaceId,
      attentionItemId,
      executorCapability: capability,
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
    ...data,
    loading,
    saveCampaign,
    saveRecurringWork,
    runRecurringWorkNow,
    deleteRecurringWork,
    dismissAttentionItem,
  };
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

// ---- Chat state ----

export type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; event: Extract<AgentEvent, { type: "message" }> };

export interface PendingApproval {
  requestId: string;
  toolName: string;
  input: unknown;
}

export interface PendingQuestion {
  requestId: string;
  questions: AgentQuestion[];
}

export interface ChatState {
  items: ChatItem[];
  streaming: string;
  status: "idle" | "running";
  /** Tool calls waiting on the user's allow/deny decision. */
  approvals: PendingApproval[];
  /** Agent questions waiting on the user's answers. */
  questions: PendingQuestion[];
  toolProgress: Record<string, string>;
  lastCostUsd?: number;
  error?: string;
}

const emptyChat: ChatState = {
  items: [],
  streaming: "",
  status: "idle",
  approvals: [],
  questions: [],
  toolProgress: {},
};

function hasToolUse(item: ChatItem, id: string) {
  return (
    item.kind === "assistant" &&
    item.event.content.some(
      (block) => block.type === "tool_use" && block.id === id,
    )
  );
}

function mergeAssistantBlocks(items: ChatItem[], blocks: ContentBlock[]) {
  const next = [...items];
  const pending: ContentBlock[] = [];

  for (const block of blocks) {
    if (block.type === "tool_use") {
      const index = next.findIndex((item) => hasToolUse(item, block.id));
      if (index < 0) {
        pending.push(block);
        continue;
      }
      const item = next[index]!;
      if (item.kind !== "assistant") continue;
      next[index] = {
        kind: "assistant",
        event: {
          ...item.event,
          content: item.event.content.map((current) =>
            current.type === "tool_use" && current.id === block.id
              ? block
              : current,
          ),
        },
      };
      continue;
    }

    if (block.type === "tool_result") {
      const pendingUse = pending.some(
        (candidate) =>
          candidate.type === "tool_use" && candidate.id === block.tool_use_id,
      );
      if (pendingUse) {
        pending.push(block);
        continue;
      }
      const index = next.findIndex((item) =>
        hasToolUse(item, block.tool_use_id),
      );
      if (index < 0) {
        pending.push(block);
        continue;
      }
      const item = next[index]!;
      if (item.kind !== "assistant") continue;
      next[index] = {
        kind: "assistant",
        event: {
          ...item.event,
          content: [
            ...item.event.content.filter(
              (current) =>
                current.type !== "tool_result" ||
                current.tool_use_id !== block.tool_use_id,
            ),
            block,
          ],
        },
      };
      continue;
    }

    pending.push(block);
  }

  if (pending.length > 0) {
    next.push({
      kind: "assistant",
      event: { type: "message", role: "assistant", content: pending },
    });
  }
  return next;
}

/** Folds one runtime event into chat state; used for live events and for
 * replaying the buffered transcript when a chat is (re)opened. */
function reduceChat(c: ChatState, event: AgentEvent): ChatState {
  switch (event.type) {
    case "stream":
      return { ...c, streaming: c.streaming + event.text, status: "running" };
    case "message": {
      const resultIds = event.content
        .filter(
          (block): block is Extract<ContentBlock, { type: "tool_result" }> =>
            block.type === "tool_result",
        )
        .map((block) => block.tool_use_id);
      const toolProgress = { ...c.toolProgress };
      for (const id of resultIds) delete toolProgress[id];

      if (event.role === "user") {
        const text = event.content
          .filter((b) => b.type === "text")
          .map((b) => (b.type === "text" ? b.text : ""))
          .join("\n");
        if (text) {
          return {
            ...c,
            streaming: "",
            status: "running",
            items: [...c.items, { kind: "user", text }],
          };
        }
        // Tool results arrive as user-role messages; render them in the
        // transcript as terminal output rather than dropping them.
        if (event.content.some((b) => b.type === "tool_result")) {
          return {
            ...c,
            items: mergeAssistantBlocks(c.items, event.content),
            toolProgress,
          };
        }
        return c;
      }
      return {
        ...c,
        streaming: "",
        items: mergeAssistantBlocks(c.items, event.content),
        toolProgress,
      };
    }
    case "toolProgress": {
      const current = c.toolProgress[event.toolUseId] ?? "";
      return {
        ...c,
        toolProgress: {
          ...c.toolProgress,
          [event.toolUseId]: `${current}${event.text}`.slice(-8_000),
        },
      };
    }
    case "permission":
      return {
        ...c,
        approvals: c.approvals.some((a) => a.requestId === event.requestId)
          ? c.approvals
          : [
              ...c.approvals,
              {
                requestId: event.requestId,
                toolName: event.toolName,
                input: event.input,
              },
            ],
      };
    case "permissionResolved":
      return {
        ...c,
        approvals: c.approvals.filter((a) => a.requestId !== event.requestId),
      };
    case "question":
      return {
        ...c,
        questions: c.questions.some((q) => q.requestId === event.requestId)
          ? c.questions
          : [
              ...c.questions,
              { requestId: event.requestId, questions: event.questions },
            ],
      };
    case "questionResolved":
      return {
        ...c,
        questions: c.questions.filter(
          (q) => q.requestId !== event.requestId,
        ),
      };
    case "result":
      return {
        ...c,
        streaming: "",
        status: "idle",
        approvals: [],
        questions: [],
        lastCostUsd: event.costUsd ?? c.lastCostUsd,
        error: event.ok ? undefined : event.error,
      };
    case "status":
      return { ...c, status: event.status === "running" ? "running" : "idle" };
    case "error":
      return { ...c, error: event.message, status: "idle" };
    case "exit":
      return {
        ...c,
        status: "idle",
        error:
          event.code && event.code !== 0
            ? `Agent process exited with code ${event.code}.`
            : c.error,
      };
    default:
      return c;
  }
}

/**
 * Chat session against the local runtime. `driver` is resolved by the caller
 * (per-chat choice > per-agent override > workspace provider) and is
 * required — no session opens until one is chosen. Changing it reopens the
 * session on the new backend.
 */
export function useAgentChat(
  agentId: string | null,
  driver: DriverType | null,
  chatIdOverride?: string,
  access?: AccessMode,
  model?: string,
  capabilities?: import("@marketer/agent-runtime/types").AgentCapabilityId[],
  integrations?: string[],
) {
  const { client, status: runtimeStatus } = useRuntime();
  const {
    cloudOrganizationId,
    capability: executorCapability,
    error: capabilityError,
  } = useWorkspaceCapability();
  const capabilityKey = capabilities?.join("\0") ?? "";
  const integrationKey = integrations?.join("\0") ?? "";
  const chatId = agentId ? (chatIdOverride ?? `${agentId}-main`) : null;
  const [chat, setChat] = useState<ChatState>(emptyChat);
  // True once the runtime has confirmed the session (history replayed).
  // Callers that auto-send a first prompt must wait for this, or the prompt
  // races the async session open and lands on a dead chat.
  const [sessionReady, setSessionReady] = useState(false);
  useEffect(() => {
    if (!capabilityError) return;
    setChat((current) => ({
      ...current,
      status: "idle",
      error: capabilityError,
    }));
  }, [capabilityError]);

  useEffect(() => {
    if (!agentId || !chatId || !driver || runtimeStatus !== "connected") return;
    if (cloudOrganizationId && !executorCapability) return;
    setChat(emptyChat);
    setSessionReady(false);
    let cancelled = false;
    // The brand brief rides along so the session opens already primed; the
    // org list is cached, so this resolves fast and the open stays snappy.
    void buildWorkspaceContext(cloudOrganizationId)
      .catch(() => undefined)
      .then((workspaceContext) => {
        if (cancelled) return;
        client.send({
          type: "openSession",
          agentId,
          chatId,
          driver,
          access,
          workspaceContext,
          model: model || getAgentOverride(cloudOrganizationId, agentId).model,
          capabilities:
            capabilities ??
            getAgentOverride(cloudOrganizationId, agentId).capabilities,
          integrations:
            integrations ??
            getAgentOverride(cloudOrganizationId, agentId).integrations,
          workspaceId: cloudOrganizationId ?? undefined,
          executorCapability: executorCapability ?? undefined,
        });
      });

    const unsub = client.subscribe((msg) => {
      if (msg.type === "error" && msg.chatId === chatId) {
        setChat((c) => ({ ...c, error: msg.message, status: "idle" }));
        return;
      }
      if (msg.type === "history" && msg.chatId === chatId) {
        // Rebuild the transcript from the runtime's buffer — resumes chats
        // across navigation and reconnects, including mid-run streaming.
        setChat(msg.events.reduce(reduceChat, emptyChat));
        setSessionReady(true);
        return;
      }
      if (msg.type !== "event" || msg.chatId !== chatId) return;
      setChat((c) => reduceChat(c, msg.event));
    });
    return () => {
      cancelled = true;
      client.send({ type: "closeSession", chatId });
      unsub();
      setSessionReady(false);
    };
  }, [
    agentId,
    chatId,
    client,
    runtimeStatus,
    driver,
    access,
    cloudOrganizationId,
    executorCapability,
    model,
    capabilityKey,
    integrationKey,
  ]);

  const send = (text: string) => {
    if (!chatId || !text.trim()) return;
    // The user turn comes back as a server echo; only reflect intent here.
    setChat((c) => ({ ...c, status: "running", error: undefined }));
    client.send({ type: "prompt", chatId, text });
  };

  const interrupt = () => {
    if (chatId) client.send({ type: "interrupt", chatId });
  };

  const respondPermission = (requestId: string, behavior: "allow" | "deny") => {
    if (chatId)
      client.send({ type: "respondPermission", chatId, requestId, behavior });
  };

  const respondQuestion = (
    requestId: string,
    answers: Record<string, string> | null,
  ) => {
    if (chatId)
      client.send({ type: "respondQuestion", chatId, requestId, answers });
  };

  const provideInput = (
    request: InputRequest,
    values: Record<string, string>,
  ) => {
    if (chatId) client.send({ type: "provideInput", chatId, request, values });
  };

  return {
    chat,
    send,
    interrupt,
    respondPermission,
    respondQuestion,
    provideInput,
    sessionReady,
    executorCapability,
  };
}
