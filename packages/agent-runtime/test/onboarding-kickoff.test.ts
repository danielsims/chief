import assert from "node:assert/strict";
import test from "node:test";

import type { AgentEvent, OnboardingWorkJob } from "../src/types.js";
import {
  ONBOARDING_OPENING_MESSAGE,
  onboardingDirectory,
  onboardingKickoffId,
  onboardingKickoffProgress,
  onboardingLocalKickoffInstructions,
  onboardingOpeningIsVisible,
  onboardingRecoveryPrompt,
} from "../src/onboarding-kickoff.js";
import { hasInitialReviewKickoff } from "../src/workspace-data.js";

const kickoffId = onboardingKickoffId("mission-control");
const kickoffPrompt: AgentEvent = {
  type: "message",
  id: kickoffId,
  role: "user",
  content: [{ type: "text", text: "Start onboarding." }],
};
const selectedJobs: OnboardingWorkJob[] = [
  {
    id: "brand",
    agentId: "brand",
    title: "Research brand",
    instructions: "Research brand",
    runAt: 1,
    timezone: "Australia/Brisbane",
    proposedToolPatterns: [],
  },
  {
    id: "prospecting",
    agentId: "prospector",
    title: "Find prospects",
    instructions: "Find prospects",
    runAt: 1,
    timezone: "Australia/Brisbane",
    proposedToolPatterns: [],
  },
  {
    id: "analytics",
    agentId: "setup",
    title: "Connect Google Analytics",
    instructions: "Connect analytics",
    runAt: 1,
    timezone: "Australia/Brisbane",
    proposedToolPatterns: [],
    setupDomain: "analytics.googleapis.com",
  },
];

void test("the opening sounds conversational and avoids em dashes", () => {
  assert.match(ONBOARDING_OPENING_MESSAGE, /^Hey, welcome to Chief 👋/);
  assert.match(ONBOARDING_OPENING_MESSAGE, /good opportunities are hiding/);
  assert.match(ONBOARDING_OPENING_MESSAGE, /I'll give you a shout/);
  assert.doesNotMatch(ONBOARDING_OPENING_MESSAGE, /—/);
});

void test("local kickoff roots stay concise and skill-backed", () => {
  const instructions = onboardingLocalKickoffInstructions(
    "mission",
    selectedJobs,
  );
  assert.match(
    instructions,
    /Hey @Marketer, use \[chief-skill:build-brand-profile\]/u,
  );
  assert.match(
    instructions,
    /Hey @Prospector, use \[chief-skill:find-buying-signals\]/u,
  );
  assert.match(
    instructions,
    /Hey @Setup, use \[chief-skill:setup-google-analytics\]/u,
  );
  assert.match(instructions, /one localTools\.channels\.members\.add call/u);
  assert.match(instructions, /channelId "mission"/u);
  assert.match(instructions, /Do not pause onboarding/u);
  assert.match(instructions, /Marketer owns deriving that understanding/u);
  assert.doesNotMatch(
    instructions,
    /ask exactly one compact structured question/u,
  );
});

void test("local kickoff treats an empty analytics selection as authoritative", () => {
  const instructions = onboardingLocalKickoffInstructions(
    "mission",
    selectedJobs.filter((job) => job.agentId !== "setup"),
  );
  assert.match(instructions, /No integration setup job was selected/);
  assert.match(instructions, /do not add Setup, connect Google Analytics/);
  assert.doesNotMatch(instructions, /chief-skill:setup-google-analytics/);
  assert.doesNotMatch(instructions, /Hey @Setup/);
});

void test("engineering kickoff asks for actionable plugin cards", () => {
  const instructions = onboardingLocalKickoffInstructions("mission", [
    {
      id: "engineering",
      agentId: "engineer",
      title: "Prepare Engineering",
      instructions: "Prepare Engineering",
      runAt: 1,
      timezone: "Australia/Brisbane",
      proposedToolPatterns: [],
    },
  ]);
  assert.match(instructions, /show us the few tools/);
  assert.match(instructions, /as plugin cards/);
  assert.match(instructions, /Keep it conversational/);
});

void test("onboarding files live inside the owning agent workspace", () => {
  assert.equal(
    onboardingDirectory("/workspaces/acme", "chief"),
    "/workspaces/acme/agents/chief/onboarding",
  );
});

void test("mission control retains the onboarding marker after earlier activity", () => {
  assert.equal(
    hasInitialReviewKickoff([
      {
        type: "message",
        id: "mission-control-onboarding-kickoff",
        role: "user",
        content: [{ type: "text", text: "Start onboarding." }],
      },
    ]),
    true,
  );
});

void test("local recovery resumes the durable plan without a second greeting", () => {
  const prompt = onboardingRecoveryPrompt(
    "opencode",
    false,
    "mission",
    selectedJobs,
  );
  assert.match(prompt, /Read onboarding\/onboarding\.md/);
  assert.match(prompt, /do not greet the user again/);
  assert.match(prompt, /publish one top-level kickoff/i);
  assert.match(prompt, /selected unconnected analytics or advertising source/);
  assert.match(prompt, /\[chief-skill:setup-google-analytics]/);
  assert.match(prompt, /Marketer.*Prospector/);
  assert.match(prompt, /Use agent ID "brand"/);
  assert.match(prompt, /Use agent ID "setup"/);
  assert.match(prompt, /Use agent ID "prospector"/);
  assert.match(prompt, /Do not search files/);
  assert.match(prompt, /do not also call specialistsDelegate/);
  assert.match(prompt, /Hey @Marketer, use \[chief-skill:build-brand-profile]/);
  assert.match(prompt, /first-party evidence/);
  assert.match(prompt, /Do not pause recovery/u);
  assert.doesNotMatch(prompt, /ask exactly one compact structured question/u);
  assert.match(prompt, /single user-facing authorization alert/);
  assert.match(
    prompt,
    /Do not create or attach a generic initial business review file/,
  );
  assert.doesNotMatch(
    prompt,
    /Save the complete review as a versioned Markdown file/,
  );
});

void test("recovery includes the exact opener only when no opener is visible", () => {
  const prompt = onboardingRecoveryPrompt(
    "opencode",
    true,
    "mission",
    selectedJobs,
  );
  assert.equal(prompt.includes(ONBOARDING_OPENING_MESSAGE), true);
  assert.match(prompt, /localTools\.channelsMessagesPost/);
  assert.match(prompt, /channelId "mission"/);
  assert.equal(
    onboardingRecoveryPrompt(
      "opencode",
      false,
      "mission",
      selectedJobs,
    ).includes(ONBOARDING_OPENING_MESSAGE),
    false,
  );
  assert.equal(onboardingOpeningIsVisible([kickoffPrompt], kickoffId), false);
  assert.equal(
    onboardingOpeningIsVisible(
      [
        kickoffPrompt,
        {
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "Welcome to Chief." }],
        },
      ],
      kickoffId,
    ),
    false,
  );
  assert.equal(
    onboardingOpeningIsVisible(
      [
        kickoffPrompt,
        {
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: ONBOARDING_OPENING_MESSAGE }],
        },
      ],
      kickoffId,
    ),
    true,
  );
  assert.equal(
    onboardingOpeningIsVisible(
      [
        kickoffPrompt,
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "publish-opener",
              name: "chief_local_localTools_channelsMessagesPost",
              input: {
                channelId: "mission",
                content: ONBOARDING_OPENING_MESSAGE,
              },
            },
          ],
        },
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "publish-opener",
              content: "published",
            },
          ],
        },
      ],
      kickoffId,
    ),
    true,
  );
});

void test("an opening message alone does not complete onboarding", () => {
  assert.deepEqual(
    onboardingKickoffProgress(
      [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "Welcome to Chief." }],
        },
        kickoffPrompt,
      ],
      kickoffId,
    ),
    { started: true, completed: false },
  );
});

void test("partial output and a failed turn remain resumable", () => {
  assert.deepEqual(
    onboardingKickoffProgress(
      [
        kickoffPrompt,
        {
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "I'll get this set up." }],
        },
        { type: "result", ok: false, error: "Agent stopped." },
      ],
      kickoffId,
    ),
    { started: true, completed: false },
  );
});

void test("only a successful result completes the kickoff", () => {
  assert.deepEqual(
    onboardingKickoffProgress(
      [kickoffPrompt, { type: "result", ok: true }],
      kickoffId,
    ),
    { started: true, completed: true },
  );
});
