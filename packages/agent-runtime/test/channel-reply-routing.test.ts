import assert from "node:assert/strict";
import test from "node:test";

import {
  channelReplyThreadRoot,
  channelRespondingAgentId,
  requestsMainChannelReply,
} from "../src/channel-reply-routing.js";
import { GETTING_STARTED_CHANNEL_ID } from "../src/channels/nip29.js";

void test("the private getting-started channel wakes Chief without a mention", () => {
  assert.equal(
    channelRespondingAgentId({
      channelId: GETTING_STARTED_CHANNEL_ID,
      isSharedChannel: true,
    }),
    "cmo",
  );
  assert.equal(
    channelRespondingAgentId({
      channelId: "general",
      isSharedChannel: true,
    }),
    undefined,
  );
  assert.equal(
    channelRespondingAgentId({
      channelId: GETTING_STARTED_CHANNEL_ID,
      isSharedChannel: true,
      mentions: ["setup"],
    }),
    "setup",
  );
});

void test("an addressed channel post receives the agent reply in a thread", () => {
  assert.equal(
    channelReplyThreadRoot({
      isSharedChannel: true,
      mentions: ["cmo"],
      messageId: "root-message",
    }),
    "root-message",
  );
});

void test("an existing thread and direct messages retain their routing", () => {
  assert.equal(
    channelReplyThreadRoot({
      isSharedChannel: true,
      mentions: ["cmo"],
      messageId: "reply",
      threadRootId: "existing-root",
    }),
    "existing-root",
  );
  assert.equal(
    channelReplyThreadRoot({
      isSharedChannel: false,
      mentions: ["cmo"],
      messageId: "direct-message",
    }),
    undefined,
  );
});

void test("an explicit main-chat instruction overrides automatic thread routing", () => {
  assert.equal(
    channelReplyThreadRoot({
      isSharedChannel: true,
      mentions: ["cmo"],
      messageId: "root-message",
      text: "Reply here in the main chat, not in a thread.",
    }),
    undefined,
  );
  assert.equal(
    channelReplyThreadRoot({
      isSharedChannel: true,
      mentions: ["cmo"],
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
      mentions: ["cmo"],
      messageId: "root-message",
      text: "The main issue is that the thread context needs more detail.",
    }),
    "root-message",
  );
});
