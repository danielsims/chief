import assert from "node:assert/strict";
import test from "node:test";

import {
  slackConversationId,
  slackSourceAllowed,
} from "../src/channels/slack-gateway.js";

void test("Slack DMs stay in one conversation while channel threads stay isolated", () => {
  const base = {
    workspaceId: "workspace",
    teamId: "T123",
    channelId: "D123",
    direct: true,
  };
  assert.equal(
    slackConversationId({ ...base, messageTs: "1" }),
    slackConversationId({ ...base, messageTs: "2" }),
  );

  const firstThread = slackConversationId({
    ...base,
    channelId: "C123",
    direct: false,
    messageTs: "1",
  });
  const secondThread = slackConversationId({
    ...base,
    channelId: "C123",
    direct: false,
    messageTs: "2",
  });
  assert.notEqual(firstThread, secondThread);
  assert.notEqual(
    firstThread,
    slackConversationId({
      ...base,
      workspaceId: "other-workspace",
      channelId: "C123",
      direct: false,
      messageTs: "1",
    }),
  );
});

void test("Slack source policy allows only configured members or channels", () => {
  assert.equal(slackSourceAllowed("U1", "C1", ["U1"], []), true);
  assert.equal(slackSourceAllowed("U2", "C1", [], ["C1"]), true);
  assert.equal(slackSourceAllowed("U2", "C2", ["U1"], ["C1"]), false);
});
