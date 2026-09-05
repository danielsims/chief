import { describe, expect, it } from "vitest";

import type { ConversationMessage } from "@chief/relay-contracts";
import {
  agentJobSchema,
  conversationIdSchema,
  messageIdSchema,
  userIdSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { PROSPECTOR_KICKOFF_INSTRUCTION } from "../src/agent-onboarding";
import {
  boundedHostedHistory,
  HOSTED_HISTORY_MESSAGE_LIMIT,
  HOSTED_KICKOFF_MAX_INFERENCE_STEPS,
  HOSTED_MENTION_CONTEXT_GUIDANCE,
  HOSTED_TOOL_SELECTION_GUIDANCE,
  hostedCompletionContract,
  hostedHistoryThreadRootId,
  hostedInferenceStepBudget,
  hostedWorkspaceContext,
} from "../src/hosted-agent-runner";
import { inheritedThreadRootId } from "../src/hosted-agent-tools/toolkits/channels";

describe("hosted agent turn context", () => {
  it("keeps research lightweight and interactive work off the computer", () => {
    expect(HOSTED_TOOL_SELECTION_GUIDANCE).toContain(
      "Use web_read for ordinary public research",
    );
    expect(HOSTED_TOOL_SELECTION_GUIDANCE).toContain(
      "browser or computer for ordinary questions or plugin setup",
    );
    expect(HOSTED_TOOL_SELECTION_GUIDANCE).toContain("plugins_list");
    expect(HOSTED_TOOL_SELECTION_GUIDANCE).toContain("plugins_recommend");
    expect(HOSTED_TOOL_SELECTION_GUIDANCE).toContain("projects_recommend");
  });

  it("primes only the latest relevant messages and excludes the triggering message", () => {
    const messages = Array.from(
      { length: HOSTED_HISTORY_MESSAGE_LIMIT + 4 },
      (_, index) => message(`message-${index}`),
    );
    const triggering = messages.at(-2);
    const bounded = boundedHostedHistory(messages, triggering?.id);

    expect(bounded).toHaveLength(HOSTED_HISTORY_MESSAGE_LIMIT);
    expect(bounded.some((candidate) => candidate.id === triggering?.id)).toBe(
      false,
    );
    expect(bounded.at(-1)?.body).toBe(
      `message-${HOSTED_HISTORY_MESSAGE_LIMIT + 1}`,
    );
  });

  it("primes a new mention thread from the surrounding channel", () => {
    const mentionMessageId = "00000000-0000-4000-8000-000000000030";

    expect(hostedHistoryThreadRootId(mentionMessageId, mentionMessageId)).toBe(
      undefined,
    );
    expect(
      hostedHistoryThreadRootId(
        mentionMessageId,
        "00000000-0000-4000-8000-000000000031",
      ),
    ).toBe(mentionMessageId);
    expect(HOSTED_MENTION_CONTEXT_GUIDANCE).toContain(
      "Use the attached recent channel messages",
    );
    expect(HOSTED_MENTION_CONTEXT_GUIDANCE).toContain(
      "Do not narrate that the user only tagged you",
    );
    expect(HOSTED_MENTION_CONTEXT_GUIDANCE).toContain("Never invent a @chief (user)");
  });

  it("requires channel creation and membership before claiming completion", () => {
    expect(
      hostedCompletionContract(
        "Create #engineering-kickoff and invite Setup, Engineer, and me to it.",
        false,
      ).requiredToolNames,
    ).toEqual(["channels_create", "channels_members_add"]);
  });

  it("bounds first-run specialist work before the general conversation limit", () => {
    expect(hostedInferenceStepBudget("workspace.kickoff.prospecting")).toBe(
      HOSTED_KICKOFF_MAX_INFERENCE_STEPS,
    );
    expect(hostedInferenceStepBudget("conversation.message")).toBeGreaterThan(
      HOSTED_KICKOFF_MAX_INFERENCE_STEPS,
    );
  });

  it("does not expose setup selections as Prospector market context", () => {
    const context = {
      managed: true,
      runtime: "cloud" as const,
      workspace: {
        id: "workspace-a",
        name: "Acme",
        website: "https://acme.test",
        selectedApps: ["granola.ai", "notion.com"],
      },
    };
    const prospector = hostedWorkspaceContext(
      testJob({}, "prospector"),
      context,
      false,
    );
    const setup = hostedWorkspaceContext(testJob({}, "setup"), context, false);

    expect(prospector).not.toContain("granola.ai");
    expect(prospector).not.toContain("notion.com");
    expect(prospector).toContain(
      "setup choices, not evidence about the product, market, or ideal customer",
    );
    expect(setup).toContain("Requested connections: granola.ai, notion.com");
  });

  it("gives Prospector a catalog-backed capability kickoff", () => {
    expect(PROSPECTOR_KICKOFF_INSTRUCTION).toContain(
      "This automatic kickoff is a capability handoff",
    );
    expect(PROSPECTOR_KICKOFF_INSTRUCTION).toContain(
      "do not attempt to discover tools with tools_search",
    );
    expect(PROSPECTOR_KICKOFF_INSTRUCTION).toContain(
      "Call plugins_list with a prospecting-related query",
    );
    expect(PROSPECTOR_KICKOFF_INSTRUCTION).toContain(
      "then call plugins_recommend once",
    );
    expect(PROSPECTOR_KICKOFF_INSTRUCTION).toContain("Prefer Needle");
  });

  it("keeps agent tool posts in the originating thread by default", () => {
    const job = testJob({
      conversationId: "marketing",
      threadRootId: "00000000-0000-4000-8000-000000000010",
    });

    expect(
      inheritedThreadRootId(job, {
        channelId: "marketing",
        content: "Brand profile complete.",
      }),
    ).toBe("00000000-0000-4000-8000-000000000010");
    expect(
      inheritedThreadRootId(job, {
        channelId: "mission-control",
        content: "Cross-channel update.",
      }),
    ).toBeUndefined();
  });

  it("honors an explicit thread when the agent targets another conversation", () => {
    const job = testJob({ conversationId: "marketing" });
    expect(
      inheritedThreadRootId(job, {
        channelId: "mission-control",
        content: "Requested handoff.",
        threadRootId: "00000000-0000-4000-8000-000000000020",
      }),
    ).toBe("00000000-0000-4000-8000-000000000020");
  });
});

function testJob(
  payload: Record<string, string>,
  agentId: "brand" | "prospector" | "setup" = "brand",
) {
  const now = new Date().toISOString();
  return agentJobSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    workspaceId: "workspace-a",
    agentId,
    kind: "conversation.message",
    payload,
    status: "leased",
    attempt: 1,
    availableAt: now,
    leaseExpiresAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

function message(body: string): ConversationMessage {
  return {
    id: messageIdSchema.parse(crypto.randomUUID()),
    workspaceId: workspaceIdSchema.parse("workspace-a"),
    conversationId: conversationIdSchema.parse("marketing"),
    author: { kind: "user", id: userIdSchema.parse("user-a") },
    body,
    mentions: [],
    components: [],
    reactions: [],
    edited: false,
    deleted: false,
    sequence: 1,
    createdAt: new Date().toISOString(),
  };
}
