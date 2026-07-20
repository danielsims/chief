import assert from "node:assert/strict";
import test from "node:test";

import {
  markdownLinkTarget,
  normalizeLocalFileLinks,
} from "../src/lib/markdown-link-target";

void test("classifies local paths and web URLs", () => {
  assert.deepEqual(markdownLinkTarget("/Users/me/a%20b.pdf"), {
    kind: "path",
    value: "/Users/me/a b.pdf",
  });
  assert.deepEqual(markdownLinkTarget("file:///Users/me/a%20b.pdf"), {
    kind: "path",
    value: "/Users/me/a b.pdf",
  });
  assert.deepEqual(markdownLinkTarget("file://localhost/Users/me/a.pdf"), {
    kind: "path",
    value: "/Users/me/a.pdf",
  });
  assert.deepEqual(markdownLinkTarget("https://example.com/report"), {
    kind: "url",
    value: "https://example.com/report",
  });
});

void test("rejects ambiguous and unsafe links", () => {
  assert.equal(markdownLinkTarget("relative/report.md"), null);
  assert.equal(markdownLinkTarget("//example.com/report"), null);
  assert.equal(markdownLinkTarget("file://server/share/report.md"), null);
  assert.equal(markdownLinkTarget("javascript:alert(1)"), null);
  assert.equal(markdownLinkTarget("data:text/plain,hello"), null);
  assert.equal(markdownLinkTarget("/Users/me/bad%ZZ.pdf"), null);
});

void test("normalizes local file URLs only inside Markdown links", () => {
  assert.equal(
    normalizeLocalFileLinks(
      "[report](file:///Users/me/a%20b.pdf) and `[raw](file:///tmp/raw.md)`",
    ),
    "[report](/Users/me/a%20b.pdf) and `[raw](file:///tmp/raw.md)`",
  );
  assert.equal(
    normalizeLocalFileLinks("[remote](file://server/share/report.md)"),
    "[remote](file://server/share/report.md)",
  );
  assert.equal(
    normalizeLocalFileLinks("![image](file:///tmp/chart.png)"),
    "![image](file:///tmp/chart.png)",
  );
});
