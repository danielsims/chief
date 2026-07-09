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
  AgentDefinition,
  AgentEvent,
  ClientMessage,
  DriverType,
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
  onStatus: (status: RuntimeStatus) => void = () => {};

  connect() {
    this.closed = false;
    this.onStatus("connecting");
    this.ws = new WebSocket(RUNTIME_URL);
    this.ws.onopen = () => {
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
      this.onStatus("disconnected");
      if (!this.closed) setTimeout(() => this.connect(), 2000);
    };
    this.ws.onerror = () => this.ws?.close();
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
    this.ws?.close();
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

export interface ChatState {
  items: ChatItem[];
  streaming: string;
  status: "idle" | "running";
  lastCostUsd?: number;
  error?: string;
}

const emptyChat: ChatState = { items: [], streaming: "", status: "idle" };

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
        if (!text) return c;
        return {
          ...c,
          streaming: "",
          status: "running",
          items: [...c.items, { kind: "user", text }],
        };
      }
      return {
        ...c,
        streaming: "",
        items: [...c.items, { kind: "assistant", event }],
      };
    }
    case "result":
      return {
        ...c,
        streaming: "",
        status: "idle",
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
 * Chat session against the local runtime. `driverOverride` is owned by the
 * chat UI (per-chat provider switcher); changing it reopens the session on
 * the new backend — the runtime stops and recreates the session when
 * openSession arrives with a different driver.
 */
export function useAgentChat(agentId: string | null, driverOverride?: DriverType) {
  const { client, status: runtimeStatus } = useRuntime();
  const chatId = agentId ? `${agentId}-main` : null;
  const [chat, setChat] = useState<ChatState>({
    items: [],
    streaming: "",
    status: "idle",
  });

  useEffect(() => {
    if (!agentId || !chatId || runtimeStatus !== "connected") return;
    setChat(emptyChat);
    const override = getAgentOverride(agentId);
    client.send({
      type: "openSession",
      agentId,
      chatId,
      driver: driverOverride ?? override.driver,
      model: override.model,
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
        return;
      }
      if (msg.type !== "event" || msg.chatId !== chatId) return;
      setChat((c) => reduceChat(c, msg.event));
    });
    return () => {
      unsub();
    };
  }, [agentId, chatId, client, runtimeStatus, driverOverride]);

  const send = (text: string) => {
    if (!chatId || !text.trim()) return;
    // The user turn comes back as a server echo; only reflect intent here.
    setChat((c) => ({ ...c, status: "running", error: undefined }));
    client.send({ type: "prompt", chatId, text });
  };

  const interrupt = () => {
    if (chatId) client.send({ type: "interrupt", chatId });
  };

  return { chat, send, interrupt };
}
