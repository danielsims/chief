import { useEffect, useState } from "react";

import { Button } from "@chief/ui/components/button";

import type { WorkspaceAgentId } from "../../lib/workspace-channels";
import {
  directMessageChatForAgent,
  workspaceDirectMessage,
} from "../../lib/workspace-channels";
import { AgentAvatar } from "../agent-avatar";

interface DirectChat {
  agent: string;
  id: string;
}

export function useRequestedDirectMessage({
  agentId,
  chats,
  loading,
  runtimeStatus,
  agents,
  start,
}: {
  agentId: string | null;
  chats: readonly DirectChat[];
  loading: boolean;
  runtimeStatus: string;
  agents: readonly { id: string }[];
  start: (agentId: string) => Promise<string>;
}) {
  const message = workspaceDirectMessage(agentId, agents);
  const chat = message ? directMessageChatForAgent(chats, message.id) : null;
  const [created, setCreated] = useState<{
    agentId: WorkspaceAgentId;
    chatId: string;
  } | null>(null);
  const [failure, setFailure] = useState<{
    agentId: WorkspaceAgentId;
    message: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const resolvedChatId =
    chat?.id ??
    (created && created.agentId === message?.id ? created.chatId : null);
  // Once a conversation is open it stays open while the lists behind it
  // refresh; a momentary gap must not swap it for the opening state.
  const [opened, setOpened] = useState<{
    agentId: string;
    chatId: string;
  } | null>(null);
  if (
    agentId &&
    resolvedChatId &&
    (opened?.agentId !== agentId || opened.chatId !== resolvedChatId)
  ) {
    setOpened({ agentId, chatId: resolvedChatId });
  }

  useEffect(() => {
    if (!message || chat || loading || runtimeStatus !== "connected") return;
    let cancelled = false;
    void start(message.id)
      .then((chatId) => {
        if (!cancelled) setCreated({ agentId: message.id, chatId });
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setFailure({
            agentId: message.id,
            message:
              reason instanceof Error
                ? reason.message
                : "Chief couldn't open this conversation.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, chat, loading, message, runtimeStatus, start]);

  return {
    chat,
    chatId:
      resolvedChatId ?? (opened?.agentId === agentId ? opened.chatId : null),
    error: failure && failure.agentId === message?.id ? failure.message : null,
    message,
    retry: () => {
      setFailure(null);
      setAttempt((value) => value + 1);
    },
  };
}

export function DirectMessageOpening({
  agentId,
  agentName,
  error,
  onRetry,
}: {
  agentId: WorkspaceAgentId;
  agentName: string;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b px-4">
        <AgentAvatar agentId={agentId} className="size-7" />
        <span className="text-sm font-semibold">{agentName}</span>
      </header>
      {/* Opening is near-instant, so it shows only the conversation frame. */}
      {error ? (
        <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-sm">
          <p>{error}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
