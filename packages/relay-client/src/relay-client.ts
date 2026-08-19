import type {
  AppendMessageCommand,
  AppendMessageResult,
  ConversationEvent,
  LogBatch,
  LogPage,
  RelayDiscovery,
  WorkspaceId,
} from "@chief/relay-contracts";
import {
  appendMessageResultSchema,
  conversationEventPageSchema,
  conversationEventSchema,
  conversationIdSchema,
  logPageSchema,
  logReceiptSchema,
  messagePageSchema,
  relayDiscoverySchema,
  socketTicketSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

export interface RelayClientOptions {
  relayUrl: string;
  workspaceId: WorkspaceId | string;
  getAccessToken: () => Promise<string>;
  fetch?: typeof globalThis.fetch;
  createWebSocket?: (url: string) => WebSocket;
}

export interface ConversationSubscription {
  close: () => void;
  cursor: () => number;
}

export class RelayClient {
  readonly workspaceId: WorkspaceId;
  private readonly relayUrl: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly createWebSocket: (url: string) => WebSocket;
  private discoveryRequest: Promise<RelayDiscovery> | null = null;

  constructor(private readonly options: RelayClientOptions) {
    this.workspaceId = workspaceIdSchema.parse(options.workspaceId);
    this.relayUrl = normalizedOrigin(options.relayUrl);
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.createWebSocket =
      options.createWebSocket ?? ((url) => new WebSocket(url));
  }

  discovery() {
    this.discoveryRequest ??= this.fetchJson(
      `${this.relayUrl}/.well-known/chief-relay`,
      relayDiscoverySchema,
      false,
    );
    return this.discoveryRequest;
  }

  async listMessages(
    conversationId: string,
    input: { after?: number; limit?: number } = {},
  ) {
    const url = this.conversationUrl(conversationId, "messages");
    appendPageQuery(url, input);
    return this.fetchJson(url, messagePageSchema);
  }

  async listEvents(
    conversationId: string,
    input: { after?: number; limit?: number } = {},
  ) {
    const url = this.conversationUrl(conversationId, "events");
    appendPageQuery(url, input);
    return this.fetchJson(url, conversationEventPageSchema);
  }

  async appendMessage(
    conversationId: string,
    command: AppendMessageCommand,
  ): Promise<AppendMessageResult> {
    return await this.fetchJson(
      this.conversationUrl(conversationId, "messages"),
      appendMessageResultSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
      },
    );
  }

  async recordLogs(batch: LogBatch) {
    return await this.fetchJson(
      this.workspaceUrl("logs"),
      logReceiptSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(batch),
      },
    );
  }

  async listLogs(
    input: { cursor?: string; limit?: number } = {},
  ): Promise<LogPage> {
    const url = this.workspaceUrl("logs");
    if (input.cursor) url.searchParams.set("cursor", input.cursor);
    if (input.limit !== undefined)
      url.searchParams.set("limit", String(input.limit));
    return await this.fetchJson(url, logPageSchema);
  }

  async subscribeConversation(input: {
    conversationId: string;
    after?: number;
    onEvent: (event: ConversationEvent) => void;
    onError?: (error: Error) => void;
  }): Promise<ConversationSubscription> {
    const discovery = await this.discovery();
    const ticket = await this.fetchJson(
      this.conversationUrl(input.conversationId, "socket-tickets"),
      socketTicketSchema,
      true,
      { method: "POST" },
    );
    const socketUrl = new URL(discovery.websocketUrl);
    socketUrl.searchParams.set("workspaceId", this.workspaceId);
    socketUrl.searchParams.set(
      "conversationId",
      conversationIdSchema.parse(input.conversationId),
    );
    socketUrl.searchParams.set("ticket", ticket.ticket);

    let cursor = input.after ?? 0;
    let catchingUp = true;
    let closed = false;
    const pending: ConversationEvent[] = [];
    const socket = this.createWebSocket(socketUrl.toString());

    const accept = (event: ConversationEvent) => {
      if (event.sequence <= cursor || closed) return;
      cursor = event.sequence;
      input.onEvent(event);
    };
    socket.addEventListener("message", (message) => {
      try {
        const event = conversationEventSchema.parse(
          JSON.parse(String(message.data)),
        );
        if (catchingUp) pending.push(event);
        else accept(event);
      } catch (error) {
        input.onError?.(asError(error));
      }
    });
    socket.addEventListener("error", () => {
      input.onError?.(new Error("The relay live connection failed."));
    });

    await waitForOpen(socket);
    try {
      let next = cursor;
      do {
        const page = await this.listEvents(input.conversationId, {
          after: next,
          limit: 200,
        });
        for (const event of page.events) accept(event);
        next = page.nextSequence ?? 0;
      } while (next > 0);
      catchingUp = false;
      [...pending]
        .sort((left, right) => left.sequence - right.sequence)
        .forEach(accept);
    } catch (error) {
      socket.close();
      throw error;
    }

    return {
      close: () => {
        closed = true;
        socket.close();
      },
      cursor: () => cursor,
    };
  }

  private conversationUrl(conversationId: string, resource: string) {
    const conversation = conversationIdSchema.parse(conversationId);
    return new URL(
      `/v1/workspaces/${encodeURIComponent(this.workspaceId)}/conversations/${encodeURIComponent(conversation)}/${resource}`,
      this.relayUrl,
    );
  }

  private workspaceUrl(resource: string) {
    return new URL(
      `/v1/workspaces/${encodeURIComponent(this.workspaceId)}/${resource}`,
      this.relayUrl,
    );
  }

  private async fetchJson<T>(
    url: URL | string,
    schema: { parse: (value: unknown) => T },
    authenticated = true,
    init: RequestInit = {},
  ) {
    const headers = new Headers(init.headers);
    if (authenticated) {
      headers.set(
        "authorization",
        `Bearer ${await this.options.getAccessToken()}`,
      );
    }
    const response = await this.fetcher(url, { ...init, headers });
    if (!response.ok) throw await RelayClientError.fromResponse(response);
    return schema.parse(await response.json());
  }
}

export class RelayClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }

  static async fromResponse(response: Response) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    return new RelayClientError(
      body?.error?.message ?? `Relay request failed with ${response.status}.`,
      response.status,
      body?.error?.code,
    );
  }
}

function normalizedOrigin(value: string) {
  const url = new URL(value);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

function appendPageQuery(url: URL, input: { after?: number; limit?: number }) {
  if (input.after !== undefined)
    url.searchParams.set("after", String(input.after));
  if (input.limit !== undefined)
    url.searchParams.set("limit", String(input.limit));
}

function waitForOpen(socket: WebSocket) {
  if (socket.readyState === 1) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("The relay live connection could not open.")),
      { once: true },
    );
  });
}

function asError(value: unknown) {
  return value instanceof Error ? value : new Error(String(value));
}
