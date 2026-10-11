import type { JsonObject } from "@chief/relay-contracts";
import { parseJsonString } from "@chief/relay-contracts";

export function relayCellWorkspaceContext(
  payload: JsonObject,
  agentId: string,
) {
  const name = parseJsonString(payload.name);
  const website = parseJsonString(payload.website);
  const selectedApps = Array.isArray(payload.selectedApps)
    ? payload.selectedApps.flatMap((value) => {
        const app = parseJsonString(value);
        return app === undefined ? [] : [app];
      })
    : [];
  return [
    name ? `Workspace: ${name}` : undefined,
    website ? `Website: ${website}` : undefined,
    agentId === "setup"
      ? selectedApps.length > 0
        ? `Requested connections: ${selectedApps.join(", ")}. These are setup requests, not proof of access.`
        : "Requested connections: none."
      : "Requested integrations are omitted because they are setup choices, not product, market, or customer evidence.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function relayCellFinalReply(
  conversationId: string,
  threadRootId: string | undefined,
) {
  const where = threadRootId
    ? `channelId ${conversationId} and threadRootId ${threadRootId}`
    : `channelId ${conversationId}`;
  return `Before substantive work, acknowledge the user with channels_messages_post (${where}): one short message saying what you are about to do. Then return exactly one user-facing final reply. Do not post that final reply yourself; Chief publishes your returned reply to the conversation. Use channels_reactions_add sparingly when a reaction is more natural than another message, never on your own message, and at most once per user message.`;
}

export function activeSkillInstructions(instructions: string) {
  return `# Active skill\n\n${instructions}`;
}
