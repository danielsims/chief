import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { SessionRecord } from "@chief/agent-runtime/types";

import { ChannelMessageMeta } from "../src/components/chat/channel-message-controls.tsx";

const specialist: SessionRecord = {
  id: "prospecting-task",
  parentId: "prospecting",
  kind: "task",
  visibility: "private",
  agent: "prospector",
  title: "Find buying signals",
  provider: "codex",
  status: "running",
  attempt: 1,
  createdAt: 1,
  updatedAt: 2,
};

void test("working specialist status does not manufacture a thread reply", () => {
  const html = renderToStaticMarkup(
    createElement(ChannelMessageMeta, {
      replies: [],
      participants: [],
      reactions: [],
      specialist,
      onOpenThread: () => undefined,
      onOpenSpecialistActivity: () => undefined,
      onToggleReaction: () => undefined,
    }),
  );

  assert.match(html, /Prospector is working/u);
  assert.match(html, /View activity/u);
  assert.match(html, /group\/activity/u);
  assert.match(html, /<button/u);
  assert.doesNotMatch(html, />1 reply</u);
  assert.doesNotMatch(html, /Last reply/u);
});
