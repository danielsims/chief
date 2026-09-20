import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { SessionRecord } from "@chief/agent-runtime/types";

import { SpecialistStatusIndicator } from "../src/components/chat/specialist-status-indicator.tsx";
import { AgentActivityCard } from "../src/components/chat/specialist-task-card.tsx";

void test("working specialists use the animated rounded matrix", () => {
  const html = renderToStaticMarkup(
    createElement(SpecialistStatusIndicator, {
      agent: "prospector",
      status: "running",
    }),
  );

  assert.match(html, /aria-label="Working"/u);
  assert.match(html, /matrix-loader-cell/u);
  assert.match(html, /rounded-\[24%\]/u);
  assert.match(html, /color:#7dc7fa/iu);
  assert.doesNotMatch(html, /animate-none/u);
});

void test("activity rows can scale the working matrix without an inset box", () => {
  const html = renderToStaticMarkup(
    createElement(SpecialistStatusIndicator, {
      agent: "engineer",
      className: "size-8 rounded-lg",
      size: 32,
      status: "running",
    }),
  );

  assert.match(html, /height:32px/u);
  assert.match(html, /width:32px/u);
  assert.match(html, /rounded-lg/u);
});

void test("failed specialists return to their normal avatar", () => {
  const html = renderToStaticMarkup(
    createElement(SpecialistStatusIndicator, {
      agent: "prospector",
      status: "failed",
    }),
  );

  assert.match(html, /aria-label="Prospector"/u);
  assert.doesNotMatch(html, /matrix-loader-cell/u);
});

void test("completed specialists return to their normal avatar", () => {
  const html = renderToStaticMarkup(
    createElement(SpecialistStatusIndicator, {
      agent: "brand",
      status: "completed",
    }),
  );

  assert.match(html, /aria-label="Marketer"/u);
  assert.doesNotMatch(html, /matrix-loader-cell/u);
});

void test("specialists waiting for the user return to their normal avatar", () => {
  const html = renderToStaticMarkup(
    createElement(SpecialistStatusIndicator, {
      agent: "setup",
      status: "waiting",
    }),
  );

  assert.match(html, /aria-label="Setup"/u);
  assert.doesNotMatch(html, /matrix-loader-cell/u);
});

void test("specialists waiting for approval retain their avatar", () => {
  const html = renderToStaticMarkup(
    createElement(SpecialistStatusIndicator, {
      agent: "engineer",
      className: "size-8 rounded-lg",
      size: 32,
      status: "needs_approval",
    }),
  );

  assert.match(html, /aria-label="Engineer"/u);
  assert.match(html, /size-8 rounded-lg/u);
});

void test("thread and panel agent cards share one standalone avatar treatment", () => {
  const task = {
    id: "engineer-task",
    kind: "task",
    visibility: "private",
    agent: "engineer",
    title: "Engineering setup",
    provider: "codex",
    status: "completed",
    attempt: 1,
    createdAt: 1,
    updatedAt: 2,
  } satisfies SessionRecord;
  const html = renderToStaticMarkup(
    createElement(AgentActivityCard, { task, detail: "Complete" }),
  );

  assert.match(html, />Engineer</u);
  assert.match(html, />Complete</u);
  assert.match(html, /size-8 rounded-lg/u);
  assert.doesNotMatch(html, /Engineering setup/u);
  assert.doesNotMatch(html, /size-9/u);
});
