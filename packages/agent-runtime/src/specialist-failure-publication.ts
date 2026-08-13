import type { ChannelEvent } from "./channel-types.js";
import type { SessionManager } from "./manager.js";
import { channelIdFromChatId, createChannelEvent } from "./channels/nip29.js";

function usefulFailureReason(error: string) {
  if (/captcha|rate.?limit|blocked|forbidden|\b403\b/i.test(error)) {
    return "The source blocked access before I could gather enough reliable evidence.";
  }
  if (/timed? out|six minutes|without progress/i.test(error)) {
    return "The run stopped after it went too long without making progress.";
  }
  if (
    /auth|sign.?in|session.*(?:ended|inactive|expired)|\b401\b/i.test(error)
  ) {
    return "The connection ended before I could finish the work.";
  }
  return "I stopped safely instead of continuing without reliable progress.";
}

/** Publishes one calm terminal update after a specialist exhausts its retries. */
export async function publishSpecialistFailure(input: {
  manager: SessionManager;
  workspaceId: string;
  conversationId: string;
  threadRootId?: string;
  sessionId: string;
  agentId: string;
  agentName: string;
  title: string;
  error: string;
  onChannelEvent?: (event: ChannelEvent) => void | Promise<void>;
}) {
  if (!input.threadRootId) return;
  const channelId = channelIdFromChatId(input.conversationId);
  if (!channelId) return;
  const sourceId = `specialist-failure:${input.sessionId}`;
  const store = input.manager.store.channelStore();
  const alreadyPublished = (
    await store.events(input.workspaceId, channelId)
  ).some((event) =>
    event.tags.some((tag) => tag[0] === "client" && tag[1] === sourceId),
  );
  if (alreadyPublished) return;

  const event = createChannelEvent({
    workspaceId: input.workspaceId,
    channelId,
    actor: { type: "agent", id: input.agentId, name: input.agentName },
    content: `I couldn’t finish “${input.title}”. ${usefulFailureReason(input.error)} Open the activity for details, or ask me to try again.`,
    sourceId,
    threadRootId: input.threadRootId,
  });
  await store.appendEvent(input.workspaceId, event);
  await input.onChannelEvent?.(event);
}
