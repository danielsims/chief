import assert from "node:assert/strict";
import test from "node:test";

import {
  googleAuthUserFromUrl,
  isGoogleAccountChooserUrl,
  withGoogleAuthUser,
} from "../src/account-session.js";

void test("reads a human-selected Google account index", () => {
  assert.equal(
    googleAuthUserFromUrl(
      "https://console.cloud.google.com/apis/library/example?authuser=3",
    ),
    "3",
  );
  assert.equal(
    googleAuthUserFromUrl(
      "https://console.cloud.google.com/apis/library/example",
    ),
    null,
  );
});

void test("pins Cloud and OAuth URLs without touching account choice", () => {
  assert.equal(
    withGoogleAuthUser(
      "https://console.cloud.google.com/auth/clients?project=video",
      "3",
    ),
    "https://console.cloud.google.com/auth/clients?project=video&authuser=3",
  );
  assert.equal(
    withGoogleAuthUser(
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=public",
      "3",
    ),
    "https://accounts.google.com/o/oauth2/v2/auth?client_id=public&authuser=3",
  );
  assert.equal(
    withGoogleAuthUser(
      "https://accounts.google.com/signin/oauth/consent?client_id=public",
      "3",
    ),
    "https://accounts.google.com/signin/oauth/consent?client_id=public&authuser=3",
  );
  const chooser =
    "https://accounts.google.com/AccountChooser?continue=https%3A%2F%2Fconsole.cloud.google.com";
  assert.equal(isGoogleAccountChooserUrl(chooser), true);
  assert.equal(withGoogleAuthUser(chooser, "3"), chooser);
});

void test("does not rewrite unrelated sites", () => {
  assert.equal(
    withGoogleAuthUser("https://example.com/?authuser=0", "3"),
    "https://example.com/?authuser=0",
  );
});
