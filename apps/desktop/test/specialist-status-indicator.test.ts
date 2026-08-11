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

void test("failed specialists retain a frozen red matrix", () => {
  const html = renderToStaticMarkup(
    createElement(SpecialistStatusIndicator, {
      agent: "prospector",
      status: "failed",
    }),
  );

  assert.match(html, /aria-label="Failed"/u);
  assert.match(html, /text-red-500/u);
  assert.match(html, /animate-none/u);
  assert.doesNotMatch(html, /rounded-full bg-red-500/u);
});

void test("completed specialists keep a quiet frozen matrix", () => {
  const html = renderToStaticMarkup(
    createElement(SpecialistStatusIndicator, {
      agent: "brand",
      status: "completed",
    }),
  );

  assert.match(html, /aria-label="Complete"/u);
  assert.match(html, /animate-none/u);
  assert.match(html, /opacity-45/u);
});
