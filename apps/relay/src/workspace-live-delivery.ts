import type { ConversationEvent, Principal } from "@chief/relay-contracts";
import { channelMemberAddedPayloadSchema } from "@chief/relay-contracts";

export function isMembershipGrantForPrincipal(
  event: ConversationEvent,
  principal: Principal,
): boolean {
  if (principal.kind !== "user") return false;
  return event.payload.message.components.some((component) => {
    if (component.kind !== "channel-action") return false;
    const payload = channelMemberAddedPayloadSchema.safeParse(
      component.payload,
    );
    if (!payload.success) return false;
    return payload.data.userIds
      .split(",")
      .some((userId) => userId === principal.userId);
  });
}
