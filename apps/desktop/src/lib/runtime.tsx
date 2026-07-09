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
  AgentDefinition,
  AgentEvent,
  ClientMessage,
  DriverType,
  InputRequest,
  ServerMessage,
} from "@marketer/agent-runtime/types";
import { getAgentOverride } from "./agent-overrides";

// "localhost" (not 127.0.0.1) — macOS ATS only exempts the literal
// localhost hostname for insecure websockets inside WKWebView.
const RUNTIME_URL = "ws://localhost:4318";

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

// ---- Chat state ----

export type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; event: Extract<AgentEvent, { type: "message" }> };

export interface PendingApproval {
  requestId: string;
  toolName: string;
  input: unknown;
}

export interface ChatState {
  items: ChatItem[];
  streaming: string;
  status: "idle" | "running";
  /** Tool calls waiting on the user's allow/deny decision. */
  approvals: PendingApproval[];
  lastCostUsd?: number;
  error?: string;
}

const emptyChat: ChatState = {
  items: [],
  streaming: "",
  status: "idle",
  approvals: [],
};

/** Folds one runtime event into chat state; used for live events and for
 * replaying the buffered transcript when a chat is (re)opened. */
function reduceChat(c: ChatState, event: AgentEvent): ChatState {
  switch (event.type) {
    case "stream":
      return { ...c, streaming: c.streaming + event.text, status: "running" };
    case "message": {
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
            items: [...c.items, { kind: "assistant", event }],
          };
        }
        return c;
      }
      return {
        ...c,
        streaming: "",
        items: [...c.items, { kind: "assistant", event }],
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
    case "result":
      return {
        ...c,
        streaming: "",
        status: "idle",
        approvals: [],
        lastCostUsd: event.costUsd ?? c.lastCostUsd,
        error: event.ok ? undefined : event.error,
      };
    case "status":
      return { ...c, status: event.status === "running" ? "running" : "idle" };
    case "error":
      return { ...c, error: event.message, status: "idle" };
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
) {
  const { client, status: runtimeStatus } = useRuntime();
  const chatId = agentId ? (chatIdOverride ?? `${agentId}-main`) : null;
  const [chat, setChat] = useState<ChatState>(emptyChat);
  // True once the runtime has confirmed the session (history replayed).
  // Callers that auto-send a first prompt must wait for this, or the prompt
  // races the async session open and lands on a dead chat.
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    if (!agentId || !chatId || !driver || runtimeStatus !== "connected") return;
    setChat(emptyChat);
    setSessionReady(false);
    client.send({
      type: "openSession",
      agentId,
      chatId,
      driver,
      access,
      model: getAgentOverride(agentId).model,
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
      unsub();
      setSessionReady(false);
    };
  }, [agentId, chatId, client, runtimeStatus, driver, access]);

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
    if (chatId) client.send({ type: "respondPermission", chatId, requestId, behavior });
  };

  const provideInput = (request: InputRequest, values: Record<string, string>) => {
    if (chatId) client.send({ type: "provideInput", chatId, request, values });
  };

  return { chat, send, interrupt, respondPermission, provideInput, sessionReady };
}
