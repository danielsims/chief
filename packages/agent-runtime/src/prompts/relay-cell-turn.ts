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

export function relayCellFinalReply(conversationId: string) {
  return `Return exactly one user-facing final reply. Do not call channels_messages_post for ${conversationId}; Chief publishes your returned reply to that conversation. Use channels_reactions_add sparingly when a reaction is more natural than another acknowledgement, never on your own message, and at most once per user message.`;
}

export function activeSkillInstructions(instructions: string) {
  return `# Active skill\n\n${instructions}`;
}
