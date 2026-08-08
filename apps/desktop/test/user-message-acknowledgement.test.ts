import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { UserMessage } from "../src/components/chat/user-message.tsx";

void test("a direct-message acknowledgement looks like an eyes reaction", () => {
  const html = renderToStaticMarkup(
    createElement(UserMessage, {
      acknowledgedBy: "Setup",
      author: { name: "Sophie" },
      text: "Can you connect GitHub?",
    }),
  );

  assert.match(html, /Setup saw this message/u);
  assert.match(html, /👀/u);
  assert.match(html, /role="status"/u);
  assert.match(html, /animation-delay:900ms/u);
});

void test("an idle direct message has no acknowledgement reaction", () => {
  const html = renderToStaticMarkup(
    createElement(UserMessage, {
      author: { name: "Sophie" },
      text: "Can you connect GitHub?",
    }),
  );

  assert.doesNotMatch(html, /saw this message/u);
  assert.doesNotMatch(html, /👀/u);
});
