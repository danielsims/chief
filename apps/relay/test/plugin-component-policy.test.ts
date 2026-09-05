import { describe, expect, it } from "vitest";

import {
  agentIdSchema,
  principalSchema,
  userIdSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { normalizeAgentMessageBody } from "../src/agent-message-publisher";
import { hostedPluginPlacement } from "../src/hosted-agent-plugin-tools";
import { validatePluginComponentPlacement } from "../src/plugin-component-policy";
import { hexKey } from "./helpers";

const workspaceId = workspaceIdSchema.parse("workspace-a");
const conversationId = "general";
const agentId = agentIdSchema.parse("advertising");
const userId = userIdSchema.parse("user-a");
const agent = principalSchema.parse({
  kind: "agent",
  agentId,
  pubkey: hexKey(agentId),
  workspaceId,
  role: "member",
});
const user = principalSchema.parse({
  kind: "user",
  userId,
  pubkey: hexKey(userId),
  workspaceId,
  role: "owner",
});

function recommendation() {
  return {
    kind: "plugin.recommendation",
    payload: {
      workspaceId,
      conversationId,
      agentId,
      pluginId: "google-ads",
      name: "Google Ads",
      description: "Manage paid acquisition campaigns.",
      category: "Advertising",
      sourceType: "discovery",
      status: "available",
      enabled: false,
      trusted: false,
      domain: "ads.google.com",
    },
  };
}

describe("plugin component policy", () => {
  it("keeps a hosted recommendation in the conversation and thread that invoked it", () => {
    expect(
      hostedPluginPlacement(
        {
          conversationId: "direct-chief",
          threadRootId: "thread-1",
        },
        { channelId: "mission-control" },
      ),
    ).toEqual({ conversationId: "direct-chief", threadRootId: "thread-1" });
  });

  it("removes em dashes at the shared agent publication boundary", () => {
    expect(normalizeAgentMessageBody("On it — I'll get oriented.")).toBe(
      "On it, I'll get oriented.",
    );
  });

  it("allows the owning agent to publish a scoped recommendation", () => {
    expect(() =>
      validatePluginComponentPlacement(
        [recommendation()],
        agent,
        workspaceId,
        conversationId,
      ),
    ).not.toThrow();
  });

  it("requires the owning agent for recommendations", () => {
    expect(() =>
      validatePluginComponentPlacement(
        [recommendation()],
        user,
        workspaceId,
        conversationId,
      ),
    ).toThrowError(/owning agent/u);
  });

  it("allows the owning agent to publish a project connect card", () => {
    expect(() =>
      validatePluginComponentPlacement(
        [
          {
            kind: "project.recommendation",
            payload: {
              workspaceId,
              conversationId,
              agentId,
              title: "Connect a repository",
              description: "Add the Git repository this workspace should work in.",
            },
          },
        ],
        agent,
        workspaceId,
        conversationId,
      ),
    ).not.toThrow();
  });
});
