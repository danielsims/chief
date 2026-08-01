import assert from "node:assert/strict";
import test from "node:test";

import { splitAgentMentions } from "../src/components/chat/agent-mention-parser.js";

void test("splits known Chief agent mentions into semantic inline tokens", () => {
  assert.deepEqual(
    splitAgentMentions("Can @Analyst review this with @Brand?"),
    [
      { type: "text", value: "Can " },
      { type: "mention", agentId: "analyst", label: "Analyst" },
      { type: "text", value: " review this with " },
      { type: "mention", agentId: "brand", label: "Brand" },
      { type: "text", value: "?" },
    ],
  );
});

void test("does not style email addresses or partial agent names", () => {
  assert.deepEqual(splitAgentMentions("mail@Analyst.io and @Branding"), [
    { type: "text", value: "mail@Analyst.io and @Branding" },
  ]);
});
