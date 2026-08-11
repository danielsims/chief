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

export interface AgentMentionRemoval {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

const AGENT_IDS_BY_NAME = new Map(
  Object.entries(WORKSPACE_AGENT_IDENTITIES).flatMap(([agentId, identity]) =>
    [identity.name, agentId, ...(agentId === "brand" ? ["Brand"] : [])].map(
      (name) =>
        [name.toLocaleLowerCase(), agentId as WorkspaceAgentId] as const,
    ),
  ),
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
      segments.push({
        type: "mention",
        agentId,
        label: WORKSPACE_AGENT_IDENTITIES[agentId].name,
      });
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

export function removeAgentMentionBeforeCaret(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): AgentMentionRemoval | undefined {
  if (selectionStart !== selectionEnd || selectionStart <= 0) return undefined;

  const hasInsertedSpacer = text[selectionStart - 1] === " ";
  const mentionEnd = hasInsertedSpacer ? selectionStart - 1 : selectionStart;

  for (const match of text.matchAll(AGENT_MENTION_PATTERN)) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    if (matchEnd !== mentionEnd) continue;

    const removalEnd = hasInsertedSpacer
      ? selectionStart
      : text[selectionStart] === " "
        ? selectionStart + 1
        : selectionStart;
    return {
      value: `${text.slice(0, matchStart)}${text.slice(removalEnd)}`,
      selectionStart: matchStart,
      selectionEnd: matchStart,
    };
  }
  return undefined;
}
