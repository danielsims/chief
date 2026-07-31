import assert from "node:assert/strict";
import test from "node:test";

import { captureGeneratedCredential } from "../src/generated-credential-capture.js";
import {
  browserCredentialSetupRecipe,
  githubSetupRecipe,
  vercelSetupRecipe,
} from "../src/integration-setup-recipes.js";

void test("resolves deterministic browser credential recipes by domain or id", () => {
  assert.equal(browserCredentialSetupRecipe("github.com"), githubSetupRecipe);
  assert.equal(browserCredentialSetupRecipe("VERCEL"), vercelSetupRecipe);
  assert.equal(browserCredentialSetupRecipe("shopify.com"), undefined);
  assert.equal(githubSetupRecipe.integration.slug, "github-rest");
  assert.match(githubSetupRecipe.providerPage, /personal-access-tokens\/new/);
  assert.equal(vercelSetupRecipe.integration.slug, "vercel-rest");
});

void test("captures GitHub tokens without returning them to the browser agent", async () => {
  const waits: { expression: string; timeout?: number }[] = [];
  const token = await captureGeneratedCredential(
    {
      getUrl: () =>
        Promise.resolve(
          "https://github.com/settings/personal-access-tokens/new",
        ),
      waitForFunction: (expression, timeout) => {
        waits.push({ expression, timeout });
        return Promise.resolve();
      },
      evaluate: <T>() =>
        Promise.resolve("github_pat_1234567890abcdefghijklmnopqrstuvwxyz" as T),
    },
    "github.com",
  );

  assert.match(token, /^github_pat_/);
  const firstWait = waits[0];
  assert.ok(firstWait);
  assert.equal(firstWait.timeout, 15_000);
  assert.match(firstWait.expression, /data-clipboard-text/);
});

void test("rejects capture from a page outside the active provider", async () => {
  await assert.rejects(
    captureGeneratedCredential(
      {
        getUrl: () => Promise.resolve("https://example.com/credential"),
        waitForFunction: () => Promise.resolve(),
        evaluate: <T>() => Promise.resolve(null as T),
      },
      "vercel.com",
    ),
    /Open vercel\.com/,
  );
});

void test("fails closed for providers without a capture descriptor", async () => {
  await assert.rejects(
    captureGeneratedCredential(
      {
        getUrl: () => Promise.resolve("https://shopify.com"),
        waitForFunction: () => Promise.resolve(),
        evaluate: <T>() => Promise.resolve(null as T),
      },
      "shopify.com",
    ),
    /not configured/,
  );
});
