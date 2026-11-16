import type { JsonObject } from "@chief/relay-contracts";
import { parseJsonString } from "@chief/relay-contracts";

export function relayCellWorkspaceContext(
  payload: JsonObject,
  agentId: string,
) {
  const name = parseJsonString(payload.name);
  const website = parseJsonString(payload.website);
  const purpose = parseJsonString(payload.purpose);
  const selectedApps = Array.isArray(payload.selectedApps)
    ? payload.selectedApps.flatMap((value) => {
        const app = parseJsonString(value);
        return app === undefined ? [] : [app];
      })
    : [];
  return [
    name ? `Workspace: ${name}${purpose ? ` (${purpose})` : ""}` : undefined,
    website ? `Website: ${website}` : undefined,
    agentId === "setup" && selectedApps.length > 0
      ? `Requested connections: ${selectedApps.join(", ")}. These are setup requests, not proof of access.`
      : undefined,
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
  return `Chief posts your returned reply to the conversation for you, so return exactly one reply and don't post it yourself. For a quick answer, a reaction or small talk, the returned reply is the only message you send. If the work will take more than a few seconds, first post one short message with channels_messages_post (${where}) saying what you're about to do, then return the result.`;
}

export function activeSkillInstructions(instructions: string) {
  return `# Active skill\n\n${instructions}`;
}
