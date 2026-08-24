import { describe, expect, it } from "vitest";

import {
  agentIdSchema,
  principalSchema,
  userIdSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

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

function action() {
  return {
    kind: "plugin.action",
    payload: {
      workspaceId,
      conversationId,
      targetAgentId: agentId,
      recommendationId: "plugin-recommendation-1",
      pluginId: "google-ads",
      pluginName: "Google Ads",
      action: "install",
    },
  };
}

describe("plugin component policy", () => {
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

  it("requires a user and exact relay scope for actions", () => {
    expect(() =>
      validatePluginComponentPlacement(
        [action()],
        agent,
        workspaceId,
        conversationId,
      ),
    ).toThrowError(/workspace user/u);
    expect(() =>
      validatePluginComponentPlacement(
        [
          {
            ...action(),
            payload: { ...action().payload, conversationId: "other" },
          },
        ],
        user,
        workspaceId,
        conversationId,
      ),
    ).toThrowError(/relay placement/u);
  });
});
