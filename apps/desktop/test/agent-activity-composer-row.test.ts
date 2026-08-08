import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentActivityComposerRow } from "../src/components/chat/agent-activity-composer-row.tsx";

void test("direct-message activity opens the detailed activity panel", () => {
  const html = renderToStaticMarkup(
    createElement(AgentActivityComposerRow, {
      agentLabel: "Setup",
      running: true,
      statusLabel: "Checking the repository",
      onOpen: () => undefined,
    }),
  );

  assert.match(html, /Setup/u);
  assert.match(html, /Checking the repository/u);
  assert.match(html, /View activity/u);
  assert.match(html, /button/u);
  assert.match(html, /duration-150 opacity-100/u);
});

void test("channel activity retains its detailed activity affordance", () => {
  const html = renderToStaticMarkup(
    createElement(AgentActivityComposerRow, {
      running: true,
      statusLabel: "Working",
      onOpen: () => undefined,
    }),
  );

  assert.match(html, /View activity/u);
  assert.match(html, /button/u);
});
