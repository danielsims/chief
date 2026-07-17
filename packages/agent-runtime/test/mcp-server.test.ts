import assert from "node:assert/strict";
import test from "node:test";

import { REMOTE_CHANNEL_ACCESS } from "../src/channels/access.js";
import { defaultMcpChatId } from "../src/mcp-server.js";

void test("remote channels use guarded host access", () => {
  assert.equal(REMOTE_CHANNEL_ACCESS, "guarded");
});

void test("default MCP chats are deterministic and workspace scoped", () => {
  assert.equal(
    defaultMcpChatId("workspace-a"),
    defaultMcpChatId("workspace-a"),
  );
  assert.notEqual(
    defaultMcpChatId("workspace-a"),
    defaultMcpChatId("workspace-b"),
  );
  assert.match(defaultMcpChatId("workspace-a"), /^mcp-chief-[a-f0-9]{24}$/);
});
