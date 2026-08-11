import assert from "node:assert/strict";
import test from "node:test";

import {
  channelReplyThreadRoot,
  channelRespondingAgentId,
  requestsMainChannelReply,
} from "../src/channel-reply-routing.js";
import { MISSION_CONTROL_CHANNEL_ID } from "../src/channels/nip29.js";

void test("an explicit specialist mention wins in mission control", () => {
  assert.equal(
    channelRespondingAgentId({
      channelId: MISSION_CONTROL_CHANNEL_ID,
      isSharedChannel: true,
      missionControlChannelId: MISSION_CONTROL_CHANNEL_ID,
      mentions: ["setup"],
    }),
    "setup",
  );
  assert.equal(
    channelRespondingAgentId({
      channelId: "general",
      isSharedChannel: true,
    }),
    undefined,
  );
});

void test("mission control wakes Chief while ordinary channels stay quiet", () => {
  assert.equal(
    channelRespondingAgentId({
      channelId: MISSION_CONTROL_CHANNEL_ID,
      isSharedChannel: true,
      missionControlChannelId: MISSION_CONTROL_CHANNEL_ID,
    }),
    "chief",
  );
  assert.equal(
    channelRespondingAgentId({
      channelId: "general",
      isSharedChannel: true,
    }),
    undefined,
  );
});

void test("an addressed channel post receives the agent reply in a thread", () => {
  assert.equal(
    channelReplyThreadRoot({
      isSharedChannel: true,
      mentions: ["chief"],
      messageId: "root-message",
    }),
    "root-message",
  );
});

void test("an existing thread and direct messages retain their routing", () => {
  assert.equal(
    channelReplyThreadRoot({
      isSharedChannel: true,
      mentions: ["chief"],
      messageId: "reply",
      threadRootId: "existing-root",
    }),
    "existing-root",
  );
  assert.equal(
    channelReplyThreadRoot({
      isSharedChannel: false,
      mentions: ["chief"],
      messageId: "direct-message",
    }),
    undefined,
  );
});

void test("an explicit main-chat instruction overrides automatic thread routing", () => {
  assert.equal(
    channelReplyThreadRoot({
      isSharedChannel: true,
      mentions: ["chief"],
      messageId: "root-message",
      text: "Reply here in the main chat, not in a thread.",
    }),
    undefined,
  );
  assert.equal(
    channelReplyThreadRoot({
      isSharedChannel: true,
      mentions: ["chief"],
      messageId: "thread-reply",
      text: "Please post your answer to the main channel.",
      threadRootId: "existing-thread",
    }),
    undefined,
  );
});

void test("ordinary references to the main issue do not change routing", () => {
  assert.equal(
    requestsMainChannelReply(
      "The main issue is that the thread context needs more detail.",
    ),
    false,
  );
  assert.equal(
    channelReplyThreadRoot({
      isSharedChannel: true,
      mentions: ["chief"],
      messageId: "root-message",
      text: "The main issue is that the thread context needs more detail.",
    }),
    "root-message",
  );
});
