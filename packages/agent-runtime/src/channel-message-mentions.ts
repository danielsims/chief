import { getAgent } from "./agents.js";

function escapedPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasTextualMention(content: string, alias: string) {
  return new RegExp(
    `(?:^|[\\s(])@${escapedPattern(alias)}(?=$|\\s|[.,!?;:)\\]}])`,
    "iu",
  ).test(content);
}

/**
 * Keep the visible @Name handoff and its durable recipient metadata aligned.
 * The API still accepts explicit IDs, while recognized text mentions provide a
 * safe fallback when an agent forgets to populate the structured field.
 */
export function normalizedChannelMentions(input: {
  availableAgentIds: readonly string[];
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
  return [...mentioned];
}
