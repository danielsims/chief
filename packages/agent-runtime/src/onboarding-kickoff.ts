import { join } from "node:path";

import type { AgentEvent, DriverType, OnboardingWorkJob } from "./types.js";

export const ONBOARDING_OPENING_MESSAGE =
  "Hey, welcome to Chief 👋 I'm getting the team together now. We'll have a look around, get to know your brand and market, and start figuring out where the good opportunities are hiding. You can hang out here and watch us work. I'll give you a shout if I need anything.";

export function onboardingLocalKickoffInstructions(
  channelId: string,
  jobs?: readonly OnboardingWorkJob[],
) {
  const brandSelected = jobs?.some((job) => job.agentId === "brand");
  const prospectorSelected = jobs?.some((job) => job.agentId === "prospector");
  const engineerSelected = jobs?.some((job) => job.agentId === "engineer");
  const setupJobs = jobs?.filter((job) => job.agentId === "setup") ?? [];
  const kickoffAgentIds = [
    ...(brandSelected ? ["brand"] : []),
    ...(prospectorSelected ? ["prospector"] : []),
    ...(engineerSelected ? ["engineer"] : []),
    ...(setupJobs.length > 0 ? ["setup"] : []),
  ];
  const templates = [
    brandSelected || jobs === undefined
      ? 'For the brand job use exactly: "Hey @Marketer, use [chief-skill:build-brand-profile] to create a useful working profile from our first-party evidence. Ask one focused question here only if a missing preference materially changes it." Use agent ID "brand" and idempotency key "onboarding-marketer-thread".'
      : undefined,
    prospectorSelected || jobs === undefined
      ? 'For the prospecting job use exactly: "Hey @Prospector, use [chief-skill:find-buying-signals] to find our first real buying signals from the best available evidence. Ask one focused question here only if it materially changes qualification." Use agent ID "prospector" and idempotency key "onboarding-prospector-thread".'
      : undefined,
    engineerSelected
      ? 'For the engineering welcome use exactly: "Hey @Engineer, say hello in Engineering and show us the few tools that fit this workspace as plugin cards. Keep it conversational. Do not change code or deploy anything yet." Use agent ID "engineer" and idempotency key "onboarding-engineer-thread".'
      : undefined,
    ...setupJobs.map((job) => {
      const domain = job.setupDomain?.trim() ?? "selected-provider";
      const skill =
        domain === "analytics.googleapis.com"
          ? "setup-google-analytics"
          : "setup-integration";
      return `For the selected setup job ${JSON.stringify(job.title)} use exactly: "Hey @Setup, use [chief-skill:${skill}] to connect ${domain}. Keep sign-in private and tell me only when you need me." Use agent ID "setup" and idempotency key ${JSON.stringify(`onboarding-setup-${domain}`)}.`;
    }),
  ].filter((template): template is string => Boolean(template));
  const setupBoundary =
    jobs === undefined
      ? "For recovery, derive provider setup only from setup jobs actually present in the saved file. Use [chief-skill:setup-integration] with that job's exact domain. If the file has no setup job, do not add Setup, infer Google Analytics, or create any provider authorization action."
      : setupJobs.length > 0
        ? `The only selected provider setup domains are ${setupJobs.map((job) => JSON.stringify(job.setupDomain ?? job.title)).join(", ")}. Do not infer or add another provider.`
        : "No integration setup job was selected. This is authoritative: do not add Setup, connect Google Analytics, infer a default analytics provider, or create a provider authorization action.";

  return [
    "Read onboarding/onboarding.md from the current working directory.",
    "Do not pause onboarding to ask what the company sells or who it serves. Launch the selected specialist work with the available workspace context. Marketer owns deriving that understanding from the website and other first-party evidence, saving a useful provisional profile, and asking later in Marketing only if one missing fact makes the work unsafe or materially misleading.",
    `The saved onboarding jobs and this selected-agent list are the only authority for initial work: ${jobs === undefined ? "derive the exact list from the saved file" : kickoffAgentIds.length > 0 ? kickoffAgentIds.map((agentId) => JSON.stringify(agentId)).join(", ") : "none"}. Never launch an agent or provider absent from that list, even if a template, capability, or general workspace instruction mentions it. An empty analytics selection is an opt-out, not permission to choose a default.`,
    setupBoundary,
    "Do not search files, inspect agent definitions, or call channel discovery tools to rediscover agents. Add only the selected agent IDs together through one localTools.channels.members.add call. Then publish one top-level kickoff for each selected independent job through localTools.channelsMessagesPost " +
      `in channelId ${JSON.stringify(channelId)}.`,
    templates.join(" "),
    "Use the full display names and mention only that message's exact agent ID. Start every selected independent job before waiting for one. Keep Analyst blocked until a selected analytics setup succeeds; if no analytics setup was selected, do not start Analyst's initial report. The channel API starts each named agent in its thread, so do not also call specialistsDelegate or claim a job started before its kickoff succeeds.",
    "Do not manufacture a generic onboarding question after kickoff. Once the selected specialists have returned, synthesize their evidence. If two or more genuinely useful next directions require the user's choice, present one compact native question in Mission Control. If one next safe step is clearly best, continue or recommend it directly without creating an action item merely to close onboarding.",
  ].join(" ");
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
  jobs?: readonly OnboardingWorkJob[],
) {
  return [
    includeOpening
      ? `Resume the initial business review for this workspace. Start by publishing this exact text with localTools.channelsMessagesPost using channelId ${JSON.stringify(channelId)}:\n\n${ONBOARDING_OPENING_MESSAGE}\n\nDo not write it as ordinary assistant text. Continue working in the same turn without another acknowledgement.`
      : "Resume the initial business review for this workspace. The opening message is already visible, so begin with the first tool call and do not greet the user again.",
    "Do not pause recovery to ask what the company sells or who it serves. Delegate with the available workspace context. Marketer owns deriving that understanding from the website and other first-party evidence, saving a useful provisional profile, and asking later in Marketing only if one missing fact makes the work unsafe or materially misleading.",
    driver === "remote"
      ? "Use current workspace context and connected cloud sources. Launch Marketer and Prospector concurrently and exactly once through Eve's declared subagents before waiting for either. Persist the brand profile through chief files.save, and persist five to eight qualified prospects with direct source URLs through chief prospects.save."
      : `${onboardingLocalKickoffInstructions(channelId, jobs)} Resume every unfinished selected job recorded in the onboarding file. Marketer's returned profile is persisted against its specialist session, so do not save or republish it from Chief.`,
    driver === "remote"
      ? "If workspace context names an unconnected analytics or advertising source, do not delegate setup. Persist one direct provider-specific connection action through chief actions.raise."
      : "For each selected unconnected analytics or advertising source, use its Setup job in the onboarding plan. Setup owns the secure browser in that kickoff thread. If sign-in or consent needs the user, keep that Setup job and browser waiting in place instead of completing it or replacing it with a generic action. Do not raise a duplicate top-level action for a waiting Setup thread.",
    "Reconcile every analytics and advertising provider chosen in workspace context against connected sources. Create one exact setup action for each genuinely unconnected provider after useful work is complete. If AI referral tracking is enabled, include an attributable AI-referral measurement plan and any honest instrumentation gap.",
    driver === "remote"
      ? "Do not ask the user for information Chief can discover. If authorization is genuinely required, complete everything else and create one distinct action per provider or user decision, with a provider-scoped stable dedupe key."
      : "Do not ask the user for information Chief can discover. A waiting Setup thread is the single user-facing authorization alert; do not mirror it into mission control as another action or browser.",
    "Missing integrations are non-blocking. Complete all public-source, brand, and prospecting work first, persist each result only in its dedicated product surface, then create only deduplicated structured setup actions with stable keys. Do not create or attach a generic initial business review file. Recording actions is not completion.",
    "Do not manufacture a generic onboarding question after recovery. Once the selected specialists have returned, synthesize their evidence. If two or more genuinely useful next directions require the user's choice, present one compact native question in Mission Control. If one next safe step is clearly best, continue or recommend it directly without creating an action item merely to close onboarding.",
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
