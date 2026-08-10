import type { ChiefUIMessage } from "@chief/agent-runtime/types";

interface ThreadAudienceMessage {
  role: ChiefUIMessage["role"];
  metadata?: Pick<NonNullable<ChiefUIMessage["metadata"]>, "mentions">;
}

function uniqueKnownAgentIds(
  agentIds: readonly string[],
  knownAgentIds: ReadonlySet<string>,
): string[] {
  return [...new Set(agentIds)].filter((agentId) => knownAgentIds.has(agentId));
}

/**
 * Returns the most recently addressed agent audience in a thread. Persisted
 * message metadata is the source of truth so the behavior survives reloads.
 */
export function threadAgentAudience(
  messages: readonly ThreadAudienceMessage[],
  knownAgentIds: ReadonlySet<string>,
): string[] {
  let audience: string[] = [];
  for (const message of messages) {
    if (message.role !== "user" || !message.metadata?.mentions?.length) {
      continue;
    }
    audience = uniqueKnownAgentIds(message.metadata.mentions, knownAgentIds);
  }
  return audience;
}

/** Explicit @mentions replace the current audience; an untagged thread reply
 * keeps the last addressed agents active. */
export function channelRecipients(
  explicitMentions: readonly string[],
  threadAudience: readonly string[],
  knownAgentIds: ReadonlySet<string>,
): string[] {
  return uniqueKnownAgentIds(
    explicitMentions.length > 0 ? explicitMentions : threadAudience,
    knownAgentIds,
  );
}
