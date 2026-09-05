import type { StaticWorkspaceAgentId } from "../../lib/workspace-channels";
import {
  isWorkspaceAgentId,
  WORKSPACE_AGENT_IDENTITIES,
} from "../../lib/workspace-channels";

export interface AgentMentionSegment {
  type: "mention";
  agentId: string;
  label: string;
  token: string;
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

export interface MentionAlias {
  id: string;
  name: string;
}

const AGENT_IDS_BY_NAME = new Map(
  Object.entries(WORKSPACE_AGENT_IDENTITIES).flatMap(([agentId, identity]) => {
    if (!isWorkspaceAgentId(agentId)) return [];
    return [
      identity.name,
      agentId,
      ...(agentId === "brand" ? ["Brand"] : []),
    ].map((name): [string, StaticWorkspaceAgentId] => [
      name.toLocaleLowerCase(),
      agentId,
    ]);
  }),
);

function mentionIdsByName(extra: readonly MentionAlias[] = []) {
  const names = new Map<string, string>(AGENT_IDS_BY_NAME);
  for (const alias of extra) {
    const id = alias.id.trim();
    const name = alias.name.trim();
    if (!id || !name) continue;
    names.set(name.toLocaleLowerCase(), id);
    names.set(id.toLocaleLowerCase(), id);
    const first = name.split(/\s+/u)[0]?.toLocaleLowerCase();
    if (first && first !== name.toLocaleLowerCase() && !names.has(first)) {
      names.set(first, id);
    }
  }
  return names;
}

function mentionPattern(idsByName: Map<string, string>) {
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])@(${[...idsByName.keys()]
      .sort((left, right) => right.length - left.length)
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
      .join("|")})(?![\\p{L}\\p{N}_-])`,
    "giu",
  );
}

const AGENT_MENTION_PATTERN = mentionPattern(AGENT_IDS_BY_NAME);

export function splitAgentMentions(
  text: string,
  extra: readonly MentionAlias[] = [],
): (AgentMentionSegment | TextSegment)[] {
  const idsByName = extra.length > 0 ? mentionIdsByName(extra) : AGENT_IDS_BY_NAME;
  const pattern = extra.length > 0 ? mentionPattern(idsByName) : AGENT_MENTION_PATTERN;
  const segments: (AgentMentionSegment | TextSegment)[] = [];
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    if (index > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, index) });
    }
    const label = match[1] ?? "";
    const agentId = idsByName.get(label.toLocaleLowerCase());
    if (agentId) {
      segments.push({
        type: "mention",
        agentId,
        token: match[0],
        label:
          WORKSPACE_AGENT_IDENTITIES[agentId as StaticWorkspaceAgentId]?.name ??
          extra
            .filter((alias) => alias.id === agentId)
            .sort((left, right) => right.name.length - left.name.length)[0]
            ?.name ??
          label,
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
  extra: readonly MentionAlias[] = [],
): AgentMentionRemoval | undefined {
  if (selectionStart !== selectionEnd || selectionStart <= 0) return undefined;

  const hasInsertedSpacer = text[selectionStart - 1] === " ";
  const mentionEnd = hasInsertedSpacer ? selectionStart - 1 : selectionStart;
  const idsByName = extra.length > 0 ? mentionIdsByName(extra) : AGENT_IDS_BY_NAME;
  const pattern = extra.length > 0 ? mentionPattern(idsByName) : AGENT_MENTION_PATTERN;

  for (const match of text.matchAll(pattern)) {
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
