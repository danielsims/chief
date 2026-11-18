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

export function relayCellFinalReply() {
  return "Chief posts your returned reply to the conversation for you, so return exactly one reply and don't post it yourself.";
}

export function activeSkillInstructions(instructions: string) {
  return `# Active skill\n\n${instructions}`;
}
