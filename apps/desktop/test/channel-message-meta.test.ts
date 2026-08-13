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

void test("working specialist status does not add a standalone footer row", () => {
  const html = renderToStaticMarkup(
    createElement(ChannelMessageMeta, {
      replies: [],
      participants: [],
      reactions: [],
      specialist,
      onOpenThread: () => undefined,
      onToggleReaction: () => undefined,
    }),
  );

  assert.equal(html, "");
});

void test("a working specialist replaces their reply avatar with the matrix", () => {
  const html = renderToStaticMarkup(
    createElement(ChannelMessageMeta, {
      replies: [{ role: "assistant", metadata: { createdAt: 2 } }],
      participants: [
        {
          id: "agent:prospector",
          agentId: "prospector",
          kind: "agent",
          name: "Prospector",
        },
      ],
      reactions: [],
      specialist,
      onOpenThread: () => undefined,
      onToggleReaction: () => undefined,
    }),
  );

  assert.match(html, /matrix-loader-cell/u);
  assert.match(html, /title="Prospector is working"/u);
  assert.match(html, />1 reply</u);
  assert.doesNotMatch(html, /View activity/u);
});
