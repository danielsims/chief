import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import type { ConversationMessage } from "@chief/relay-contracts";
import { appendMessageCommandSchema } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";

import type { ConversationAuxiliaryPanelSizing } from "../components/chat/conversation-auxiliary-panel";
import {
  ChiefMessage,
  MessageBlocksContent,
} from "../components/chat/chief-chat-message-components";
import {
  ConversationAuxiliaryPanel,
  ConversationAuxiliaryPanelBody,
  ConversationAuxiliaryPanelHeader,
} from "../components/chat/conversation-auxiliary-panel";
import { conversationVisibleBlocks } from "../components/chat/conversation-visible-blocks";
import { UserMessage } from "../components/chat/user-message";
import { withoutMarkerLines } from "../lib/integration-setup";
import { parseRelayError } from "../lib/relay-runtime-errors";
import {
  agentWorkingChange,
  isAgentActivityProjection,
  toChiefMessage,
} from "../lib/relay-runtime-mappers";
import { useRelaySession } from "../lib/relay-session-context";
import { messageBlocks } from "../lib/runtime";
import { AutomationComposer } from "./automation-describe";

/** Which conversation an automation's chat is on; Clear starts another. */
const sessionKey = (workspaceId: string, automationId: string) =>
  `chief.automation-chat-session:${workspaceId}:${automationId}`;

function readSession(key: string) {
  try {
    const session = localStorage.getItem(key);
    return session && /^[0-9a-f-]{36}$/u.test(session) ? session : null;
  } catch {
    return null;
  }
}

function writeSession(key: string, session: string) {
  try {
    localStorage.setItem(key, session);
  } catch {
    // Without storage the chat starts afresh on the next app load.
  }
}

// The last messages read per chat, so coming back to the page shows them at
// once instead of an empty panel until the read lands.
const cached = new Map<string, ConversationMessage[]>();

/** Chief is mid-turn: the latest word is the person's, or a run is open. */
function chiefIsWorking(messages: readonly ConversationMessage[]) {
  for (const message of [...messages].reverse()) {
    const change = agentWorkingChange(message);
    if (change) return change.working;
    if (!isAgentActivityProjection(message))
      return message.author.kind === "user";
  }
  return false;
}

/**
 * An automation's chat with Chief, in a conversation of its own that only
 * this page shows. Chief builds and refines the automation with its own
 * tools, so each reply may have changed what's saved.
 */
export function useAutomationChat(automationId: string, onReply: () => void) {
  const { client, snapshot } = useRelaySession();
  const key = snapshot?.id ? sessionKey(snapshot.id, automationId) : "";
  const [session, setSession] = useState(() => (key ? readSession(key) : null));
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>(
    () => cached.get(`${key}:${session ?? ""}`) ?? [],
  );
  const [sending, setSending] = useState(false);
  // Another automation has its own chat.
  const [shownKey, setShownKey] = useState(key);
  if (shownKey !== key) {
    const next = key ? readSession(key) : null;
    setShownKey(key);
    setSession(next);
    setConversationId(null);
    setMessages(cached.get(`${key}:${next ?? ""}`) ?? []);
  }
  const replyRef = useRef(onReply);
  useEffect(() => {
    replyRef.current = onReply;
  });

  // Find the chat's conversation once there is a session to look up.
  useEffect(() => {
    if (!client || !session || conversationId) return;
    let live = true;
    void client.schedules
      .chat(automationId, session)
      .then((id) => {
        if (live) setConversationId(id);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [automationId, client, conversationId, session]);

  const working = sending || chiefIsWorking(messages);
  // Quick while Chief is working, slow otherwise.
  const replies = useRef(-1);
  useEffect(() => {
    if (!client || !conversationId) return;
    let live = true;
    const load = () =>
      void client
        .listMessages(conversationId, { recent: true, limit: 100 })
        .then((page) => {
          if (!live) return;
          const next = [...page.messages].sort(
            (left, right) => left.sequence - right.sequence,
          );
          cached.set(`${key}:${session ?? ""}`, next);
          setMessages(next);
          const count = next.filter(
            (message) =>
              message.author.kind === "agent" &&
              !isAgentActivityProjection(message),
          ).length;
          if (replies.current >= 0 && count > replies.current)
            replyRef.current();
          replies.current = count;
        })
        .catch(() => undefined);
    load();
    const timer = window.setInterval(load, working ? 2_000 : 15_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [client, conversationId, key, session, working]);

  const send = useCallback(
    async (text: string) => {
      if (!client || !key) return false;
      setSending(true);
      try {
        let current = session;
        if (!current) {
          current = crypto.randomUUID();
          writeSession(key, current);
          setSession(current);
        }
        const id =
          conversationId ??
          (await client.schedules.chat(automationId, current));
        setConversationId(id);
        const { message } = await client.appendMessage(
          id,
          appendMessageCommandSchema.parse({
            commandId: crypto.randomUUID(),
            protocolVersion: 1,
            occurredAt: new Date().toISOString(),
            payload: {
              messageId: crypto.randomUUID(),
              conversationId: id,
              body: text,
            },
          }),
        );
        setMessages((previous) => [...previous, message]);
        return true;
      } catch (cause) {
        toast.error(
          parseRelayError(cause).message || "Couldn't send that to Chief.",
        );
        return false;
      } finally {
        setSending(false);
      }
    },
    [automationId, client, conversationId, key, session],
  );

  const clear = useCallback(() => {
    if (!key) return;
    const next = crypto.randomUUID();
    writeSession(key, next);
    setSession(next);
    setConversationId(null);
    setMessages([]);
    replies.current = -1;
  }, [key]);

  return { messages, working, sending, send, clear };
}

const visibleBlocks = (message: ReturnType<typeof toChiefMessage>) =>
  conversationVisibleBlocks(withoutMarkerLines(messageBlocks(message)));

/** The automation's conversation with Chief, beside the canvas. */
export function AutomationChatPanel({
  chat,
  sizing,
  className,
  onClose,
}: {
  chat: ReturnType<typeof useAutomationChat>;
  sizing: ConversationAuxiliaryPanelSizing;
  className?: string;
  onClose: () => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  const shown = chat.messages.filter(
    (message) => !isAgentActivityProjection(message),
  );
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [shown.length, chat.working]);
  return (
    <ConversationAuxiliaryPanel
      onClose={onClose}
      sizing={sizing}
      className={className}
    >
      <ConversationAuxiliaryPanelHeader
        title="Chief"
        subtitle={
          chat.working ? (
            <span className="chief-shimmer-text">Chief is working…</span>
          ) : undefined
        }
        actions={
          shown.length ? (
            <Button
              type="button"
              aria-label="Clear chat"
              title="Clear chat"
              variant="ghost"
              size="icon-sm"
              onClick={chat.clear}
            >
              <RotateCcw size={14} />
            </Button>
          ) : null
        }
        onClose={onClose}
      />
      <ConversationAuxiliaryPanelBody className="space-y-2 overflow-x-hidden px-4 py-4">
        {shown.map((message) => {
          const ui = toChiefMessage(message);
          if (message.author.kind === "user")
            return (
              <UserMessage
                key={message.id}
                text={message.body}
                timestamp={ui.metadata?.createdAt}
              />
            );
          if (visibleBlocks(ui).length === 0) return null;
          return (
            <ChiefMessage
              key={message.id}
              messageId={message.id}
              timestamp={ui.metadata?.createdAt}
            >
              <MessageBlocksContent message={ui} filter={visibleBlocks} />
            </ChiefMessage>
          );
        })}
        <div ref={end} />
      </ConversationAuxiliaryPanelBody>
      <div className="shrink-0 p-3 pt-0">
        <AutomationComposer
          busy={chat.sending}
          disabled={false}
          className="w-full max-w-none"
          onSubmit={chat.send}
        />
      </div>
    </ConversationAuxiliaryPanel>
  );
}
