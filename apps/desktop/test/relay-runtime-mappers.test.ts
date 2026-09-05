import assert from "node:assert/strict";
import test from "node:test";

import type { MessageComponent } from "@chief/relay-contracts";
import {
  conversationMessageSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import {
  agentRunEvent,
  browserRuntimeEvent,
  isAgentActivityProjection,
  toChannelEvents,
  toChiefMessage,
} from "../src/lib/relay-runtime-mappers.ts";

const snapshot = workspaceSnapshotSchema.parse({
  id: "workspace-a",
  name: "Acme",
  website: "",
  selectedApps: [],
  runtime: "cloud",
  imageURL: null,
  onboardingComplete: true,
  conversations: [],
  agents: [
    {
      id: "advertising",
      name: "Advertising",
      role: "Paid Acquisition",
      status: "idle",
    },
  ],
  projects: [],
  createdAt: "2026-08-22T00:00:00.000Z",
});

void test("hosted browser activity opens the existing browser UI stream", () => {
  const activity = message([
    {
      id: "browser-1",
      kind: "browser",
      version: 1,
      payload: {
        browserRunId: "job-1",
        status: "active",
        url: "https://example.com/",
        streamUrl: "wss://computer.example/v1/browser/stream?ticket=signed",
        expiresAt: "2026-08-22T01:00:00.000Z",
        runId: "job-1",
        jobId: "job-1",
      },
    },
  ]);

  assert.equal(isAgentActivityProjection(activity), true);
  assert.deepEqual(browserRuntimeEvent(activity), {
    type: "browserNavigate",
    browserRunId: "job-1",
    workspaceId: "workspace-a",
    conversationId: "marketing",
    anchorMessageId: "activity-1",
    url: "https://example.com/",
    streamUrl: "wss://computer.example/v1/browser/stream?ticket=signed",
  });
});

function message(components: MessageComponent[], body = "") {
  return conversationMessageSchema.parse({
    id: body ? "message-1" : "activity-1",
    workspaceId: "workspace-a",
    conversationId: "marketing",
    author: { kind: "agent", id: "advertising" },
    body,
    components,
    createdAt: "2026-08-22T00:00:00.000Z",
    sequence: 1,
  });
}

void test("agent activity renders in chat activity but not channel read state", () => {
  const activity = message([
    {
      id: "tool-1",
      kind: "tool",
      version: 1,
      payload: {
        name: "relay_channels_list",
        status: "completed",
        input: "{}",
        output: '{"channels":[]}',
      },
    },
  ]);

  assert.equal(isAgentActivityProjection(activity), true);
  assert.deepEqual(toChannelEvents(activity, snapshot, null), []);
  assert.deepEqual(toChiefMessage(activity).parts, [
    { type: "text", text: "" },
    {
      type: "dynamic-tool",
      toolCallId: "tool-1",
      toolName: "relay_channels_list",
      input: "{}",
      state: "output-available",
      output: '{"channels":[]}',
    },
  ]);
});

void test("authored agent replies remain channel events", () => {
  const reply = message([], "Audit complete.");

  assert.equal(isAgentActivityProjection(reply), false);
  assert.equal(toChannelEvents(reply, snapshot, null).length, 1);
});

void test("threaded agent replies keep NIP-29 root markers on first paint", () => {
  const reply = conversationMessageSchema.parse({
    id: "marketer-ack",
    workspaceId: "workspace-a",
    conversationId: "mission-control",
    threadRootId: "chief-assignment",
    author: { kind: "agent", id: "advertising" },
    body: "I’m on it.",
    components: [],
    createdAt: "2026-08-22T00:00:00.000Z",
    sequence: 2,
  });
  const [event] = toChannelEvents(reply, snapshot, null);
  assert.ok(event);
  assert.deepEqual(
    event.tags.filter((tag) => tag[0] === "e"),
    [
      ["e", "chief-assignment", "", "root"],
      ["e", "chief-assignment", "", "reply"],
    ],
  );
});

void test("relay membership components retain their channel action", () => {
  const membership = conversationMessageSchema.parse({
    id: "membership-1",
    workspaceId: "workspace-a",
    conversationId: "mission-control",
    author: { kind: "system", id: "relay" },
    body: "Chief added Marketer and Prospector to the channel.",
    components: [
      {
        id: "membership-component-1",
        kind: "channel-action",
        version: 1,
        payload: {
          type: "member-added",
          actorId: "chief",
          actorName: "Chief",
          actorType: "agent",
          targetId: "brand",
          targetKind: "agent",
          targetName: "Marketer",
          targetIds: "brand,prospector",
          targetNames: "Marketer,Prospector",
          agentIds: "brand,prospector",
          userIds: "",
        },
      },
    ],
    createdAt: "2026-08-22T00:00:00.000Z",
    sequence: 2,
  });

  assert.deepEqual(toChiefMessage(membership).metadata?.channelAction, {
    type: "member-added",
    actorId: "chief",
    actorName: "Chief",
    actorType: "agent",
    agentIds: ["brand", "prospector"],
    userIds: [],
  });
});

void test("durable activity errors terminate the working indicator", () => {
  const failure = message([
    {
      id: "error-1",
      kind: "error",
      version: 1,
      payload: {
        code: "agent_run_failed",
        title: "Run interrupted",
        message: "The relay write failed.",
        retryable: "true",
      },
    },
  ]);

  assert.deepEqual(agentRunEvent(failure), {
    type: "error",
    agentId: "advertising",
    code: "agent_run_failed",
    title: "Run interrupted",
    message: "The relay write failed.",
  });
});

void test("durable plugin components map to actionable provider-neutral cards", () => {
  const recommendation = message(
    [
      {
        id: "plugin-card-1",
        kind: "plugin.recommendation",
        version: 1,
        payload: {
          workspaceId: "workspace-a",
          conversationId: "marketing",
          agentId: "advertising",
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
      },
    ],
    "These are the best matches.",
  );

  assert.deepEqual(toChiefMessage(recommendation).parts[1], {
    type: "data-plugin-recommendations",
    data: {
      plugins: [
        {
          id: "google-ads",
          name: "Google Ads",
          description: "Manage paid acquisition campaigns.",
          category: "Advertising",
          status: "available",
          enabled: false,
          trusted: false,
          source: {
            type: "discovery",
            registry: "relay",
            domain: "ads.google.com",
          },
          domains: ["ads.google.com"],
        },
      ],
      workspaceId: "workspace-a",
      conversationId: "marketing",
      agentId: "advertising",
      recommendationId: "message-1",
    },
  });
});

void test("project recommendation components become connect cards", () => {
  const recommendation = message(
    [
      {
        id: "project-card-1",
        kind: "project.recommendation",
        version: 1,
        payload: {
          workspaceId: "workspace-a",
          conversationId: "marketing",
          agentId: "advertising",
          title: "Connect a repository",
          description: "Add the Git repository this workspace should work in.",
          remoteUrl: "https://github.com/acme/program.git",
        },
      },
    ],
    "I'll start from the repo.",
  );

  assert.deepEqual(toChiefMessage(recommendation).parts[1], {
    type: "data-project-recommendation",
    data: {
      title: "Connect a repository",
      description: "Add the Git repository this workspace should work in.",
      remoteUrl: "https://github.com/acme/program.git",
    },
  });
});
