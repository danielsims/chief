import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SpecialistStatusIndicator } from "../src/components/chat/specialist-status-indicator.tsx";

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
  assert.doesNotMatch(html, /animate-none/u);
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
