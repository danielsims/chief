import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";

import { StreamingMarkdown } from "../src/components/chat/streaming-markdown.tsx";
import { ChiefNavigationContext } from "../src/lib/chief-navigation-context.ts";

void test("Markdown hard breaks and inline images do not crash conversation rendering", async () => {
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(
    createElement(
      ChiefNavigationContext.Provider,
      { value: { open: () => undefined } },
      createElement(StreamingMarkdown, {
        children:
          "**On Device**\n\nFirst line.\\\n\\\nPlease inspect the files.\n\nA picture: ![Example](https://example.com/image.png)",
      }),
    ),
    {
      onError: (error) => {
        errors.push(error);
      },
    },
  );
  await stream.allReady;
  const html = await new Response(stream).text();
  assert.deepEqual(errors, []);
  assert.match(html, /<br\s*\/?\s*>/u);
  assert.match(html, /<img\b/u);
  assert.match(html, /Please inspect the files/u);
  assert.match(html, /data-streamdown="strong">On Device</u);
});
