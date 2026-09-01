const OPENING_MESSAGE =
  "Hey, welcome to Chief 👋 I'm getting the team together now. We'll have a look around, get to know your brand and market, and start figuring out where the good opportunities are hiding. You can hang out here and watch us work. I'll give you a shout if I need anything.";

export function workspaceOnboardingDelegation(selectedApps: readonly string[]) {
  return [
    {
      agentId: "brand",
      body: "Hey @Marketer, use [chief-skill:build-brand-profile] to create a useful working profile from our first-party evidence. Ask one focused question here only if a missing preference materially changes it.",
    },
    {
      agentId: "prospector",
      body: "Hey @Prospector, use [chief-skill:find-buying-signals] to find our first real buying signals from the best available evidence. Ask one focused question here only if it materially changes qualification.",
    },
    {
      agentId: "engineer",
      body: "Hey @Engineer, get oriented and prepare the Engineering workspace. Don't change code or deploy anything yet.",
    },
    ...(selectedApps.length > 0
      ? [
          {
            agentId: "setup",
            body: `Hey @Setup, privately help me connect the selected apps: ${[...selectedApps].sort().join(", ")}. Start with what can be verified safely and only ask me to step in for sign-in, consent, or an unavoidable account choice.`,
          },
        ]
      : []),
  ];
}

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
  const delegation = workspaceOnboardingDelegation(input.selectedApps);
  const delegatedAgentIds = delegation.map(({ agentId }) => agentId);
  const kickoffMessages = delegation
    .map(
      ({ agentId, body }) =>
        `- mentions [${JSON.stringify(agentId)}], idempotencyKey onboarding-${agentId}-thread: ${JSON.stringify(body)}`,
    )
    .join("\n");

  return `CHIEF_DELEGATION_REQUIRED

Open Mission Control for ${input.name}. Website: ${website}. Selected apps: ${apps}.
Use workspace tools to carry out the complete kickoff once. This is real work, not a description of what you might do. Every channels_messages_post call below must include its stated idempotencyKey so retrying this durable turn cannot duplicate a visible message.

1. First call channels_messages_post with channelId mission-control, idempotencyKey onboarding-chief-opening, and this exact content:
${OPENING_MESSAGE}
2. Invite the delegated agent IDs to mission-control with exactly one channels_members_add call whose members are ${JSON.stringify(delegatedAgentIds.map((id) => ({ type: "agent", id })))}. Never split this into separate membership calls.
3. Post each top-level kickoff message below in mission-control using channels_messages_post:
${kickoffMessages}

Make every call now. Do not replace any tool call with prose. After every call succeeds, return one short private completion sentence; it won't be posted to the channel.`;
}

export { OPENING_MESSAGE as WORKSPACE_ONBOARDING_OPENING_MESSAGE };
