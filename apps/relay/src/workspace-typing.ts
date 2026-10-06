import type { JsonObject } from "@chief/relay-contracts";
import { conversationIdSchema } from "@chief/relay-contracts";

import type { WorkspaceSocketAttachment } from "./workspace-socket-state";
import { isGuestListener } from "./channel-guest-listeners";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import { workspaceSocketAttachment } from "./workspace-socket-state";

/**
 * Fans a person's typing signal out to the other people watching that
 * conversation. Nothing is stored; receivers expire it on their own.
 */
export function relayConversationTyping(
  ctx: DurableObjectState,
  env: Env,
  socket: WebSocket,
  sender: WorkspaceSocketAttachment,
  input: JsonObject,
) {
  if (sender.principal.kind !== "user" || !sender.subscribed) return;
  const parsed = conversationIdSchema.safeParse(input.conversationId);
  if (!parsed.success) return;
  const conversationId = parsed.data;
  if (!sender.conversationIds.includes(conversationId)) return;
  const channels = new WorkspaceChannelStore(ctx.storage, env);
  if (!channels.canReadConversation(conversationId, sender.principal)) return;
  const userId = sender.principal.userId;
  const event = JSON.stringify({
    type: "conversation.typing",
    conversationId,
    userId,
    active: input.active !== false,
  });
  for (const peer of ctx.getWebSockets()) {
    if (peer === socket || isGuestListener(ctx, peer)) continue;
    try {
      const reader = workspaceSocketAttachment(peer);
      if (
        !reader.subscribed ||
        !reader.typing ||
        reader.principal.kind !== "user" ||
        reader.principal.userId === userId ||
        !reader.conversationIds.includes(conversationId)
      )
        continue;
      peer.send(event);
    } catch {
      // Typing is best-effort; a bad socket is handled by real deliveries.
    }
  }
}
