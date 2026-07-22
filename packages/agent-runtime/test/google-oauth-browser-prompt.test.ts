import assert from "node:assert/strict";
import test from "node:test";

import { gmailRecipe } from "@chief/google-oauth-connector";

import {
  googleOAuthAuthenticatedBrowserPrompt,
  googleOAuthInterruptedBrowserPrompt,
} from "../src/google-oauth-browser-prompt.js";

const options = {
  recipe: gmailRecipe,
  afterCaptureInstruction: "Then continue with Gmail authorization.",
};

void test("builds a reusable Google OAuth prompt from the active recipe", () => {
  const prompt = googleOAuthAuthenticatedBrowserPrompt({
    ...options,
    lockedAuthUser: "3",
  });

  assert.match(prompt, /Google OAuth authentication finished/);
  assert.match(prompt, /Chief - Gmail/);
  assert.match(prompt, /gmail\.googleapis\.com/);
  assert.match(prompt, /check for an exact Desktop app match/);
  assert.match(prompt, /do not create another client/);
  assert.match(prompt, /authuser=3/);
  assert.match(prompt, /post-login URL.*untrusted/);
  assert.match(prompt, /Then continue with Gmail authorization/);
  assert.doesNotMatch(prompt, /Google Analytics authenticated browser/);
});

void test("recovers an interrupted OAuth browser without reprovisioning", () => {
  const prompt = googleOAuthInterruptedBrowserPrompt(options);

  assert.match(prompt, /Resume the interrupted Google OAuth setup/);
  assert.match(prompt, /do not call googleOAuth\.provisionClient again/i);
  assert.match(prompt, /Chief - Gmail/);
});
