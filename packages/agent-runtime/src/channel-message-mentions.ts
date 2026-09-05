import { getAgent } from "./agents.js";

function escapedPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasTextualMention(content: string, alias: string) {
  const trimmed = alias.trim();
  if (!trimmed) return false;
  return new RegExp(
    `(?:^|[\\s(*_~])@${escapedPattern(trimmed)}(?=$|\\s|[.,!?;:)\\]}*_~])`,
    "iu",
  ).test(content);
}

export function personMentionAliases(person: { id: string; name?: string }) {
  const aliases = [person.id.trim()].filter(Boolean);
  const name = person.name?.trim();
  if (!name) return aliases;
  aliases.push(name);
  const first = name.split(/\s+/u)[0];
  if (first && first !== name) aliases.push(first);
  return aliases;
}

export function messageMentionsPerson(input: {
  content: string;
  mentions?: readonly string[];
  person: { id: string; name?: string };
}) {
  if (input.mentions?.includes(input.person.id)) return true;
  return personMentionAliases(input.person).some((alias) =>
    hasTextualMention(input.content, alias),
  );
}

/**
 * Keep the visible @Name handoff and its durable recipient metadata aligned.
 * The API still accepts explicit IDs, while recognized text mentions provide a
 * safe fallback when an agent forgets to populate the structured field.
 */
export function normalizedChannelMentions(input: {
  availableAgentIds: readonly string[];
  people?: readonly { id: string; name?: string }[];
  content: string;
  explicitMentions: readonly string[];
}) {
  const mentioned = new Set(input.explicitMentions);
  for (const agentId of input.availableAgentIds) {
    const name = getAgent(agentId)?.name;
    const aliases = [agentId, name].filter((alias): alias is string =>
      Boolean(alias?.trim()),
    );
    if (aliases.some((alias) => hasTextualMention(input.content, alias))) {
      mentioned.add(agentId);
    }
  }
  for (const person of input.people ?? []) {
    if (
      messageMentionsPerson({
        content: input.content,
        mentions: input.explicitMentions,
        person,
      })
    ) {
      mentioned.add(person.id);
    }
  }
  return [...mentioned];
}
