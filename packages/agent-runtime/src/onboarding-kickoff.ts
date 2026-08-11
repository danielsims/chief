import { join } from "node:path";

import type { AgentEvent, DriverType } from "./types.js";

export const ONBOARDING_OPENING_MESSAGE =
  "Hey, welcome to Chief 👋 I'm getting the team together now. We'll have a look around, get to know your brand and market, and start figuring out where the good opportunities are hiding. You can hang out here and watch us work. I'll give you a shout if I need anything.";

export function onboardingLocalKickoffInstructions(channelId: string) {
  return `Read onboarding/onboarding.md from the current working directory. The exact agent IDs are "brand" for Marketer, "setup" for Setup, and "prospector" for Prospector. Do not search files, inspect agent definitions, or call channel discovery tools to rediscover them. Add every selected agent together through one localTools.channels.members.add call. Then publish one top-level kickoff per independent job through localTools.channelsMessagesPost in channelId ${JSON.stringify(channelId)}. Use these exact two-sentence shapes with the real workspace details: "Hey @Marketer, use [chief-skill:build-brand-profile] to create a profile for <company> from <website>. Ground its voice, vocabulary, audience, and claims in first-party evidence." "Hey @Prospector, use [chief-skill:find-buying-signals] to find our first real buying signals. Focus on <selected sources> and save only evidence-backed prospects." "Hey @Setup, use [chief-skill:setup-google-analytics] to connect <provider>. Keep sign-in private and tell me only when you need me." Use the full display names and mention only that message's exact agent ID. Use idempotency keys "onboarding-marketer-thread", "onboarding-prospector-thread", and "onboarding-setup-<provider-domain>". Start every independent job before waiting for one. Keep Analyst blocked until analytics succeeds. The channel API starts each named agent in its thread, so do not also call specialistsDelegate or claim a job started before its kickoff succeeds.`;
}

export function onboardingKickoffId(chatId: string) {
  return `${chatId}-kickoff`;
}

export function onboardingDirectory(workspaceRoot: string, agentId: string) {
  return join(workspaceRoot, "agents", agentId, "onboarding");
}

export function onboardingOpeningIsVisible(
  events: readonly AgentEvent[],
  kickoffId: string,
) {
  const kickoffIndex = events.findIndex(
    (event) =>
      event.type === "message" &&
      event.role === "user" &&
      event.id === kickoffId,
  );
  if (kickoffIndex < 0) return false;
  const remaining = events.slice(kickoffIndex + 1);
  for (const [eventIndex, event] of remaining.entries()) {
    if (event.type !== "message" || event.role !== "assistant") continue;
    if (
      event.content.some(
        (block) =>
          block.type === "text" &&
          block.text.includes(ONBOARDING_OPENING_MESSAGE),
      )
    ) {
      return true;
    }
    for (const block of event.content) {
      if (block.type !== "tool_use") continue;
      const input =
        block.input && typeof block.input === "object"
          ? (block.input as Record<string, unknown>)
          : {};
      if (
        !block.name.toLowerCase().includes("channelsmessagespost") ||
        typeof input.content !== "string" ||
        !input.content.includes(ONBOARDING_OPENING_MESSAGE)
      ) {
        continue;
      }
      const succeeded = remaining
        .slice(eventIndex + 1)
        .some(
          (candidate) =>
            candidate.type === "message" &&
            candidate.role === "user" &&
            candidate.content.some(
              (result) =>
                result.type === "tool_result" &&
                result.tool_use_id === block.id &&
                result.is_error !== true,
            ),
        );
      if (succeeded) return true;
    }
  }
  return false;
}

export function onboardingRecoveryPrompt(
  driver: DriverType,
  includeOpening: boolean,
  channelId: string,
) {
  return [
    includeOpening
      ? `Resume the initial business review for this workspace. Start by publishing this exact text with localTools.channelsMessagesPost using channelId ${JSON.stringify(channelId)}:\n\n${ONBOARDING_OPENING_MESSAGE}\n\nDo not write it as ordinary assistant text. Continue working in the same turn without another acknowledgement.`
      : "Resume the initial business review for this workspace. The opening message is already visible, so begin with the first tool call and do not greet the user again.",
    driver === "remote"
      ? "Use current workspace context and connected cloud sources. Launch Marketer and Prospector concurrently and exactly once through Eve's declared subagents before waiting for either. Persist the brand profile and full review through chief files.save, and persist five to eight qualified prospects with direct source URLs through chief prospects.save."
      : `${onboardingLocalKickoffInstructions(channelId)} Resume every unfinished job recorded in the onboarding file. Marketer's returned profile is persisted against its specialist session, so do not save or republish it from Chief.`,
    driver === "remote"
      ? "If workspace context names an unconnected analytics or advertising source, do not delegate setup. Persist one direct provider-specific connection action through chief actions.raise."
      : "For each selected unconnected analytics or advertising source, use its Setup job in the onboarding plan. Setup owns the secure browser in that kickoff thread. If sign-in or consent needs the user, keep that Setup job and browser waiting in place instead of completing it or replacing it with a generic action. Do not raise a duplicate top-level action for a waiting Setup thread.",
    "Reconcile every analytics and advertising provider chosen in workspace context against connected sources. Create one exact setup action for each genuinely unconnected provider after useful work is complete. If AI referral tracking is enabled, include an attributable AI-referral measurement plan and any honest instrumentation gap.",
    driver === "remote"
      ? "Do not ask the user for information Chief can discover. If authorization is genuinely required, complete everything else and create one distinct action per provider or user decision, with a provider-scoped stable dedupe key."
      : "Do not ask the user for information Chief can discover. A waiting Setup thread is the single user-facing authorization alert; do not mirror it into mission control as another action or browser.",
    "Missing integrations are non-blocking. Complete and save all public-source, brand, and prospecting work first. Save the complete review as a versioned Markdown file under reviews/, include the document in the synthesis, then create only deduplicated structured setup actions with stable keys. Recording actions is not completion.",
  ].join("\n\n");
}

/**
 * A welcome or partial progress message is not proof that onboarding finished.
 * Only a successful provider result after the durable kickoff prompt closes the
 * run; this lets a reopened workspace resume after a crash or failed turn.
 */
export function onboardingKickoffProgress(
  events: readonly AgentEvent[],
  kickoffId: string,
) {
  const kickoffIndex = events.findIndex(
    (event) =>
      event.type === "message" &&
      event.role === "user" &&
      event.id === kickoffId,
  );
  return {
    started: kickoffIndex >= 0,
    completed:
      kickoffIndex >= 0 &&
      events
        .slice(kickoffIndex + 1)
        .some((event) => event.type === "result" && event.ok),
  };
}
