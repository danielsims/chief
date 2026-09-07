import assert from "node:assert/strict";
import test from "node:test";
import type { DefaultTreeAdapterMap } from "parse5";
import { parse } from "parse5";

import { artifactDocument } from "../src/components/files/artifact-document.ts";

function elements(
  parent: DefaultTreeAdapterMap["parentNode"],
): DefaultTreeAdapterMap["element"][] {
  return parent.childNodes.flatMap((node) =>
    "tagName" in node ? [node, ...elements(node)] : [],
  );
}

void test("artifact preview removes executable content and every supplied navigation mechanism", () => {
  const document =
    artifactDocument(`<script>location.replace('https://example.com/leak')</script>
    <meta http-equiv="refresh" content="0;url=https://example.com/leak">
    <base href="https://example.com"><a href="https://example.com" ping="https://example.com">Read</a>
    <iframe srcdoc="<script>alert(1)</script>"></iframe><form action="https://example.com"><input></form>
    <svg><a href="https://example.com">svg</a></svg><math><mtext>math</mtext></math>
    <div onclick="location='https://example.com'">Safe</div><img src="https://example.com/leak" onerror="alert(1)">
    <object data="https://example.com"></object><template><script>alert(1)</script></template>`);
  const nodes = elements(parse(document));
  assert.equal(
    nodes.some((node) =>
      [
        "script",
        "base",
        "iframe",
        "form",
        "input",
        "svg",
        "math",
        "object",
        "template",
      ].includes(node.tagName),
    ),
    false,
  );
  assert.equal(
    nodes.some((node) =>
      node.attrs.some((attribute) =>
        ["href", "ping", "srcdoc", "action", "onclick", "onerror"].includes(
          attribute.name,
        ),
      ),
    ),
    false,
  );
  assert.equal(
    nodes.some(
      (node) =>
        node.tagName === "meta" &&
        node.attrs.some(
          (attribute) => attribute.value.toLowerCase() === "refresh",
        ),
    ),
    false,
  );
  assert.match(document, /script-src 'none'/u);
  assert.match(document, />Safe</u);
});

void test("artifact preview keeps report layout, inline styles and embedded raster images", () => {
  const document = artifactDocument(
    '<style>td{color:red}</style><h1>Report</h1><table><tr><td colspan="2">42</td></tr></table><img alt="Chart" src="data:image/png;base64,aGVsbG8=">',
  );
  assert.match(document, /<style>td\{color:red\}<\/style>/u);
  assert.match(document, /<h1>Report<\/h1>/u);
  assert.match(document, /colspan="2"/u);
  assert.match(document, /src="data:image\/png;base64,aGVsbG8="/u);
});
