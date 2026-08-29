import assert from "node:assert/strict";
import test from "node:test";

import { relayCookiePrefix } from "../src/cookie-prefix.js";

void test("relay cookie namespaces include the complete authority origin", () => {
  const first = relayCookiePrefix("http://localhost:8080");
  const second = relayCookiePrefix("http://localhost:9090");

  assert.notEqual(first, second);
  assert.equal(first, relayCookiePrefix("http://localhost:8080/path"));
  assert.match(first, /^[a-z\d_]+$/u);
});
