import assert from "node:assert/strict";
import test from "node:test";

import {
  formatComposerText,
  insertComposerText,
  openComposerMention,
} from "../src/components/chat/composer-editing.js";

void test("wraps selected composer text and preserves the selection", () => {
  assert.deepEqual(formatComposerText("make this bold", 5, 9, "bold"), {
    value: "make **this** bold",
    selectionStart: 7,
    selectionEnd: 11,
  });
});

void test("opens a mention once without toggling or inserting another at sign", () => {
  assert.deepEqual(openComposerMention("Hello", 5, 5), {
    value: "Hello @",
    selectionStart: 7,
    selectionEnd: 7,
  });
  assert.equal(openComposerMention("Hello @", 7, 7), undefined);
});

void test("inserts an editable formatting placeholder at the cursor", () => {
  assert.deepEqual(formatComposerText("Say ", 4, 4, "italic"), {
    value: "Say _italic text_",
    selectionStart: 5,
    selectionEnd: 16,
  });
});

void test("formats every selected line as an ordered list", () => {
  assert.deepEqual(formatComposerText("one\ntwo", 0, 7, "ordered-list"), {
    value: "1. one\n2. two",
    selectionStart: 0,
    selectionEnd: 13,
  });
});

void test("creates a link with the URL selected when text is selected", () => {
  assert.deepEqual(formatComposerText("Chief docs", 0, 5, "link"), {
    value: "[Chief](https://) docs",
    selectionStart: 8,
    selectionEnd: 16,
  });
});

void test("inserts toolbar content at the preserved cursor", () => {
  assert.deepEqual(insertComposerText("Hello there", 6, 11, "@Chief "), {
    value: "Hello @Chief ",
    selectionStart: 13,
    selectionEnd: 13,
  });
});
