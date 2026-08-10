import { join } from "node:path";

import type { AgentEvent, DriverType } from "./types.js";

export const ONBOARDING_OPENING_MESSAGE =
  "Hey, welcome to Chief 👋 I'm getting the team together now. We'll have a look around, get to know your brand and market, and start figuring out where the good opportunities are hiding. You can hang out here and watch us work. I'll give you a shout if I need anything.";

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
  return (
    kickoffIndex >= 0 &&
    events
      .slice(kickoffIndex + 1)
      .some(
        (event) =>
          event.type === "message" &&
          event.role === "assistant" &&
          event.content.some(
            (block) =>
              block.type === "text" &&
              block.text.includes(ONBOARDING_OPENING_MESSAGE),
          ),
      )
  );
}

export function onboardingRecoveryPrompt(
  driver: DriverType,
  includeOpening: boolean,
) {
  return [
    includeOpening
      ? `Resume the initial business review for this workspace. Start by sending this exact text followed by [message:send]:\n\n${ONBOARDING_OPENING_MESSAGE}\n\nContinue working in the same turn without another acknowledgement.`
      : "Resume the initial business review for this workspace. The opening message is already visible, so begin with the first tool call and do not greet the user again.",
    driver === "remote"
      ? "Use current workspace context and connected cloud sources. Launch Brand Researcher and Prospector concurrently and exactly once through Eve's declared subagents before waiting for either. Persist the brand profile and full review through chief files.save, and persist five to eight qualified prospects with direct source URLs through chief prospects.save."
      : "Read onboarding/getting-started.md from the current working directory and resume every unfinished job recorded there. Launch Brand Researcher and Prospector concurrently and exactly once with localTools.specialistsDelegate, omitting waitSeconds so both continue in the background. Reuse stable delegation IDs and never start equivalent duplicate specialists. Save the verified brand Markdown with localTools.brandProfileSave and retain its visible versioned file. Require Prospector to persist five to eight qualified results with direct source URLs through prospectsSave.",
    driver === "remote"
      ? "If workspace context names an unconnected analytics or advertising source, do not delegate setup. Persist one direct provider-specific connection action through chief actions.raise."
      : "If workspace context names an unconnected analytics or advertising source, do not delegate setup. Create one direct provider-specific connection action.",
    "Reconcile every analytics and advertising provider chosen in workspace context against connected sources. Create one exact setup action for each genuinely unconnected provider after useful work is complete. If AI referral tracking is enabled, include an attributable AI-referral measurement plan and any honest instrumentation gap.",
    "Do not ask the user for information Chief can discover. If authorization is genuinely required, complete everything else and create one distinct action per provider or user decision, with a provider-scoped stable dedupe key.",
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
