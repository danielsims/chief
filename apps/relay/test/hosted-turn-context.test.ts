import { describe, expect, it } from "vitest";

import type { ConversationMessage } from "@chief/relay-contracts";
import {
  agentJobSchema,
  conversationIdSchema,
  messageIdSchema,
  userIdSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import {
  boundedHostedHistory,
  HOSTED_HISTORY_MESSAGE_LIMIT,
  HOSTED_TOOL_SELECTION_GUIDANCE,
  hostedCompletionContract,
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
      `message-${HOSTED_HISTORY_MESSAGE_LIMIT + 3}`,
    );
  });

  it("requires channel creation and membership before claiming completion", () => {
    expect(
      hostedCompletionContract(
        "Create #engineering-kickoff and invite Setup, Engineer, and me to it.",
        false,
      ).requiredToolNames,
    ).toEqual(["channels_create", "channels_members_add"]);
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

function testJob(payload: Record<string, string>) {
  const now = new Date().toISOString();
  return agentJobSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    workspaceId: "workspace-a",
    agentId: "brand",
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
