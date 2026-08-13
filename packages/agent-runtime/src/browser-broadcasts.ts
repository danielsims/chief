import type { BrowserPresentationMode, ServerMessage } from "./types.js";

type Send = (workspaceId: string, message: ServerMessage) => void;

export function createBrowserBroadcasts(input: {
  browserKey: (workspaceId: string, conversationId: string) => string;
  runIds: ReadonlyMap<string, string>;
  threadRoots: ReadonlyMap<string, string | undefined>;
  parentConversations: ReadonlyMap<string, string | undefined>;
  anchorMessages: ReadonlyMap<string, string>;
  send: Send;
}) {
  const runId = (
    workspaceId: string,
    conversationId: string,
    requested?: string,
  ) =>
    requested ??
    input.runIds.get(input.browserKey(workspaceId, conversationId));

  const navigate = (
    workspaceId: string,
    conversationId: string,
    url: string,
    streamUrl: string,
    requested?: string,
  ) => {
    const browserRunId = runId(workspaceId, conversationId, requested);
    if (!browserRunId) return;
    const threadRootId = input.threadRoots.get(browserRunId);
    const parentConversationId = input.parentConversations.get(browserRunId);
    const anchorMessageId = input.anchorMessages.get(browserRunId);
    if (process.env.CHIEF_DEBUG_SESSION_FORCE === "1") {
      console.error(
        `[browser-broadcast] conversation=${conversationId} threadRoot=${threadRootId ?? "none"} anchor=${anchorMessageId ?? "none"} url=${url}`,
      );
    }
    input.send(workspaceId, {
      type: "browserNavigate",
      browserRunId,
      workspaceId,
      conversationId,
      parentConversationId,
      threadRootId,
      anchorMessageId,
      url,
      streamUrl,
    });
  };

  const prepare = (
    workspaceId: string,
    conversationId: string,
    url: string,
    requested?: string,
  ) => {
    const browserRunId = runId(workspaceId, conversationId, requested);
    if (!browserRunId) return;
    input.send(workspaceId, {
      type: "browserPrepare",
      browserRunId,
      workspaceId,
      conversationId,
      parentConversationId: input.parentConversations.get(browserRunId),
      threadRootId: input.threadRoots.get(browserRunId),
      anchorMessageId: input.anchorMessages.get(browserRunId),
      url,
    });
  };

  const activity = (
    workspaceId: string,
    conversationId: string,
    value: Extract<ServerMessage, { type: "browserActivity" }> extends infer T
      ? Omit<
          Extract<T, object>,
          "type" | "browserRunId" | "workspaceId" | "conversationId"
        >
      : never,
    requested?: string,
  ) => {
    const browserRunId = runId(workspaceId, conversationId, requested);
    if (!browserRunId) return;
    input.send(workspaceId, {
      type: "browserActivity",
      browserRunId,
      workspaceId,
      conversationId,
      ...value,
    });
  };

  const presentation = (
    workspaceId: string,
    conversationId: string,
    mode: BrowserPresentationMode,
    requested?: string,
  ) => {
    const browserRunId = runId(workspaceId, conversationId, requested);
    if (!browserRunId) return;
    input.send(workspaceId, {
      type: "browserPresentation",
      browserRunId,
      workspaceId,
      conversationId,
      mode,
    });
  };

  const closed = (
    workspaceId: string,
    conversationId: string,
    requested?: string,
  ) => {
    const browserRunId = runId(workspaceId, conversationId, requested);
    if (!browserRunId) return;
    input.send(workspaceId, {
      type: "browserClosed",
      browserRunId,
      workspaceId,
      conversationId,
    });
  };

  return { activity, closed, navigate, prepare, presentation };
}
