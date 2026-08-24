import assert from "node:assert/strict";
import test from "node:test";

import { parseClientMessage } from "../src/client-message-parser.js";

const executorCapability = {
  apiBaseUrl: "http://127.0.0.1:4318",
  token: "capability-token",
};

void test("parses a complete client message", () => {
  const message = parseClientMessage(
    JSON.stringify({
      type: "sendMessage",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      messageId: "message-1",
      text: "Hello",
      executorCapability,
    }),
  );

  assert.deepEqual(message, {
    type: "sendMessage",
    workspaceId: "workspace-1",
    chatId: "chat-1",
    messageId: "message-1",
    text: "Hello",
    executorCapability,
  });
});

void test("rejects malformed client messages", () => {
  assert.equal(parseClientMessage("not-json"), undefined);
  assert.equal(
    parseClientMessage(
      JSON.stringify({
        type: "sendMessage",
        workspaceId: "workspace-1",
        chatId: "chat-1",
        messageId: "message-1",
        text: "Hello",
      }),
    ),
    undefined,
  );
  assert.equal(
    parseClientMessage(
      JSON.stringify({
        type: "browserViewportResize",
        workspaceId: "workspace-1",
        conversationId: "chat-1",
        browserRunId: "run-1",
        width: "wide",
        height: 720,
      }),
    ),
    undefined,
  );
});
