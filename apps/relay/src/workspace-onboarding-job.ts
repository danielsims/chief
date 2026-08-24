const OPENING_MESSAGE =
  "Hey, welcome to Chief 👋 I'm getting the team together now. We'll have a look around, get to know your brand and market, and start figuring out where the good opportunities are hiding. You can hang out here and watch us work. I'll give you a shout if I need anything.";

/**
 * Canonical cross-platform kickoff contract. The relay places this instruction
 * in Chief's durable mailbox so phone, desktop, and hosted cells execute the
 * same workflow instead of maintaining platform-specific onboarding prompts.
 */
export function workspaceOnboardingInstruction(input: {
  name: string;
  website: string;
  selectedApps: readonly string[];
}) {
  const website = input.website.trim() || "not supplied";
  const apps =
    input.selectedApps.length > 0
      ? [...input.selectedApps].sort().join(", ")
      : "none selected";
  const delegatedAgentIds =
    input.selectedApps.length > 0
      ? ["brand", "prospector", "engineer", "setup"]
      : ["brand", "prospector", "engineer"];
  const setupKickoff =
    input.selectedApps.length > 0
      ? `\n- idempotencyKey onboarding-setup-thread: "Hey @Setup, privately help me connect the selected apps: ${apps}. Start with what can be verified safely and only ask me to step in for sign-in, consent, or an unavoidable account choice."`
      : "";

  return `CHIEF_DELEGATION_REQUIRED

Open Mission Control for ${input.name}. Website: ${website}. Selected apps: ${apps}.
Use relay tools to carry out the complete kickoff once. This is real work, not a description of what you might do. Every relay_message_post call below must include its stated idempotencyKey so retrying this durable turn cannot duplicate a visible message.

1. First call relay_message_post in mission-control with idempotencyKey onboarding-chief-opening and this exact opening:
${OPENING_MESSAGE}
2. Invite the delegated agent IDs to mission-control with exactly one relay_channels_members_add call using kind agent and principalIds ${JSON.stringify(delegatedAgentIds)}. Never split this into separate membership calls.
3. Post each top-level kickoff message below in mission-control using relay_message_post:
- idempotencyKey onboarding-marketer-thread: "Hey @Marketer, use [chief-skill:build-brand-profile] to create a useful working profile from our first-party evidence. Ask one focused question here only if a missing preference materially changes it."
- idempotencyKey onboarding-prospector-thread: "Hey @Prospector, use [chief-skill:find-buying-signals] to find our first real buying signals from the best available evidence. Ask one focused question here only if it materially changes qualification."
- idempotencyKey onboarding-engineer-thread: "Hey @Engineer, get oriented and prepare the Engineering workspace. Don't change code or deploy anything yet."${setupKickoff}

Make every call now. Do not replace any tool call with prose. After every call succeeds, return one short private completion sentence; it won't be posted to the channel.`;
}

export { OPENING_MESSAGE as WORKSPACE_ONBOARDING_OPENING_MESSAGE };
