import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { BrowserStreamMessage } from "../src/index.js";
import { browserKeyboardInput } from "../src/index.js";
import { lastUsedChromeProfile } from "../src/node.js";

void test("models the official agent-browser frame protocol", () => {
  const message: BrowserStreamMessage = {
    type: "frame",
    data: "jpeg",
    metadata: {
      deviceHeight: 720,
      deviceWidth: 1280,
      offsetTop: 0,
      pageScaleFactor: 1,
      scrollOffsetX: 0,
      scrollOffsetY: 0,
    },
  };
  assert.equal(message.metadata.deviceWidth, 1280);
});

void test("allows providers to publish remote cursor semantics", () => {
  const message: BrowserStreamMessage = {
    type: "cursor",
    cursor: "pointer",
  };
  assert.equal(message.cursor, "pointer");
});

void test("sends printable text on keyDown using the official stream shape", () => {
  const message = browserKeyboardInput(
    {
      altKey: false,
      code: "KeyA",
      ctrlKey: false,
      key: "a",
      metaKey: false,
      shiftKey: false,
    },
    "keyDown",
  );

  assert.deepEqual(message, {
    type: "input_keyboard",
    eventType: "keyDown",
    key: "a",
    code: "KeyA",
    text: "a",
    windowsVirtualKeyCode: 65,
    modifiers: 0,
  });
});

void test("maps punctuation to Chrome virtual key codes", () => {
  const message = browserKeyboardInput(
    {
      altKey: false,
      code: "Period",
      ctrlKey: false,
      key: ".",
      metaKey: false,
      shiftKey: false,
    },
    "keyDown",
  );

  assert.equal(message.text, ".");
  assert.equal(message.windowsVirtualKeyCode, 190);
});

void test("maps control keys and omits text on keyUp", () => {
  const event = {
    altKey: false,
    code: "Enter",
    ctrlKey: false,
    key: "Enter",
    metaKey: false,
    shiftKey: false,
  };

  assert.equal(browserKeyboardInput(event, "keyDown").text, "\r");
  assert.equal(
    browserKeyboardInput(event, "keyDown").windowsVirtualKeyCode,
    13,
  );
  assert.equal(browserKeyboardInput(event, "keyUp").text, undefined);
});

void test("resolves only Chrome's last-used profile directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chief-chrome-profile-"));
  const localState = join(directory, "Local State");
  await writeFile(
    localState,
    JSON.stringify({
      profile: {
        info_cache: {
          "Profile 1": { name: "Work" },
          "Profile 2": { name: "Personal" },
        },
        last_used: "Profile 2",
      },
    }),
  );

  assert.equal(lastUsedChromeProfile(localState), "Profile 2");
});
