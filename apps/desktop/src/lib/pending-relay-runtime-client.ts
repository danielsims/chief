import type {
  RuntimeConnectionStatus,
  RuntimeMessageListener,
  RuntimeTransport,
} from "./runtime-transport";

export class PendingRelayRuntimeClient implements RuntimeTransport {
  private statusListener: (status: RuntimeConnectionStatus) => void = () =>
    undefined;
  private listeners = new Set<RuntimeMessageListener>();

  constructor(private readonly error: string | null) {}

  setStatusListener(listener: (status: RuntimeConnectionStatus) => void) {
    this.statusListener = listener;
  }

  connect() {
    this.statusListener(this.error ? "disconnected" : "connecting");
    if (!this.error) return;
    for (const listener of this.listeners) {
      listener({ type: "error", message: this.error });
    }
  }

  reconnectNow() {
    this.connect();
  }

  startDirectMessage() {
    return Promise.reject(
      new Error(this.error ?? "The Chief relay is still connecting."),
    );
  }

  removeAgent() {
    return Promise.reject(
      new Error(this.error ?? "The Chief relay is still connecting."),
    );
  }

  createNativeAgent() {
    return Promise.reject(
      new Error(this.error ?? "The Chief relay is still connecting."),
    );
  }

  send() {
    for (const listener of this.listeners) {
      listener({
        type: "error",
        message: this.error ?? "The Chief relay is still connecting.",
      });
    }
  }

  subscribe(listener: RuntimeMessageListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy() {
    this.statusListener("disconnected");
    this.listeners.clear();
  }
}
