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
  assert.match(html, /duration-150/u);
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

void test("simultaneous thread agents are all represented", () => {
  const html = renderToStaticMarkup(
    createElement(AgentActivityComposerRow, {
      agents: [
        { id: "prospector", label: "Prospector" },
        { id: "brand", label: "Marketer" },
        { id: "setup", label: "Setup" },
      ],
      running: true,
      statusLabel: "Working",
      onOpen: () => undefined,
    }),
  );

  assert.match(html, /Prospector, Marketer, and Setup are working/u);
  assert.match(html, /Prospector is working/u);
  assert.match(html, /Marketer is working/u);
  assert.match(html, />\+1</u);
});

void test("inactive activity reserves the composer presence row", () => {
  const html = renderToStaticMarkup(
    createElement(AgentActivityComposerRow, {
      running: false,
      statusLabel: "",
      onOpen: () => undefined,
    }),
  );

  assert.match(html, /class="h-8 shrink-0"/u);
  assert.match(html, /aria-hidden="true"/u);
  assert.doesNotMatch(html, /img|avatar|working|typing/iu);
});
