import assert from "node:assert/strict";
import test from "node:test";

import { chatDayKey } from "../src/components/chat/chat-date-time";

void test("chat date groups keep messages from the same local day together", () => {
  const morning = new Date(2026, 7, 12, 9, 15).getTime();
  const evening = new Date(2026, 7, 12, 22, 45).getTime();
  const tomorrow = new Date(2026, 7, 13, 0, 1).getTime();

  assert.equal(chatDayKey(morning), chatDayKey(evening));
  assert.notEqual(chatDayKey(evening), chatDayKey(tomorrow));
  assert.equal(chatDayKey(undefined), null);
});
