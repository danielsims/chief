import type { WorkspaceAgentId } from "../../lib/workspace-channels";
import { WORKSPACE_AGENT_IDENTITIES } from "../../lib/workspace-channels";

export interface AgentMentionSegment {
  type: "mention";
  agentId: WorkspaceAgentId;
  label: string;
}

interface TextSegment {
  type: "text";
  value: string;
}

const AGENT_IDS_BY_NAME = new Map(
  Object.entries(WORKSPACE_AGENT_IDENTITIES).map(([agentId, identity]) => [
    identity.name.toLocaleLowerCase(),
    agentId as WorkspaceAgentId,
  ]),
);

const AGENT_MENTION_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}_])@(${[...AGENT_IDS_BY_NAME.keys()]
    .sort((left, right) => right.length - left.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("|")})(?![\\p{L}\\p{N}_-])`,
  "giu",
);

export function splitAgentMentions(
  text: string,
): (AgentMentionSegment | TextSegment)[] {
  const segments: (AgentMentionSegment | TextSegment)[] = [];
  let cursor = 0;

  for (const match of text.matchAll(AGENT_MENTION_PATTERN)) {
    const index = match.index;
    if (index > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, index) });
    }
    const label = match[1] ?? "";
    const agentId = AGENT_IDS_BY_NAME.get(label.toLocaleLowerCase());
    if (agentId) {
      segments.push({ type: "mention", agentId, label });
    } else {
      segments.push({ type: "text", value: match[0] });
    }
    cursor = index + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }
  return segments.length > 0 ? segments : [{ type: "text", value: text }];
}
