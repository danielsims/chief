import assert from "node:assert/strict";
import test from "node:test";

import { ProviderAuthentication } from "../src/provider-authentication.js";

void test("resumes the same setup agent when provider sign-in completes", async () => {
  let currentUrl = "https://github.com/login";
  const continuations: string[] = [];
  const authentication = new ProviderAuthentication({
    browserKey: (workspaceId, sessionId) => `${workspaceId}/${sessionId}`,
    continueSession: (_workspaceId, _sessionId, message) => {
      continuations.push(message);
      return Promise.resolve();
    },
    openBrowser: () =>
      Promise.resolve({ getUrl: () => Promise.resolve(currentUrl) }),
    progress: () => undefined,
    pollIntervalMs: 5,
  });

  const result = await authentication.open({
    workspaceId: "workspace",
    sessionId: "session",
    attemptId: "attempt",
    rawTargetUrl: "https://github.com/settings/personal-access-tokens/new",
    capability: { apiBaseUrl: "https://executor.test", token: "capability" },
    setup: {
      attemptId: "attempt",
      domain: "github.com",
      expiresAt: Date.now() + 60_000,
      integrationSlug: "github-rest",
      recipeId: "github",
    },
  });
  assert.equal(result.status, "authentication-required");

  currentUrl = "https://github.com/settings/personal-access-tokens/new";
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(continuations.length, 1);
  assert.match(
    continuations[0] ?? "",
    /Operate every post-login provider control/,
  );
  authentication.clear("workspace", "session");
});
