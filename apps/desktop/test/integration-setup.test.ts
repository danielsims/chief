import assert from "node:assert/strict";
import test from "node:test";

import type { ChiefUIMessage } from "@chief/agent-runtime/types";

import {
  GOOGLE_ANALYTICS_OAUTH_INPUT_REQUEST,
  googleAnalyticsActionChatId,
  googleAnalyticsActionIdFromChat,
  integrationProviderMatchesDomain,
  integrationSetupChannelPath,
  integrationSetupChatId,
  integrationSetupDomainFromChat,
  integrationSetupTask,
  isGoogleAnalyticsOAuthRequest,
  latestSetupAttempt,
  persistSetupResult,
  SETUP_ATTEMPT_PREFIX,
  setupResultMatchesIntegration,
  stripPrivateSetupInstructions,
} from "../src/lib/integration-setup.ts";

void test("integration setup starts visibly in a private Setup conversation", () => {
  const path = integrationSetupChannelPath(
    { domain: "github.com", name: "GitHub" },
    "attempt-one",
  );
  const url = new URL(path, "https://chief.local");
  assert.equal(url.searchParams.get("dm"), "setup");
  assert.equal(url.searchParams.get("channel"), null);
  assert.equal(url.searchParams.get("setup"), "github.com");
  assert.equal(url.searchParams.get("chat"), null);
  assert.match(
    url.searchParams.get("prompt") ?? "",
    /^\[chief-integration-setup:attempt-one\]\n\n\[chief-skill:setup-github\]\n\n@Setup,/u,
  );
});

void test("recognizes Google OAuth actions by secure field destinations", () => {
  assert.equal(
    isGoogleAnalyticsOAuthRequest({
      ...GOOGLE_ANALYTICS_OAUTH_INPUT_REQUEST,
      id: "opaque-action-request",
    }),
    true,
  );
  assert.equal(
    isGoogleAnalyticsOAuthRequest({
      ...GOOGLE_ANALYTICS_OAUTH_INPUT_REQUEST,
      fields: GOOGLE_ANALYTICS_OAUTH_INPUT_REQUEST.fields.slice(0, 1),
    }),
    false,
  );
});

void test("Google Analytics uses the secure setup skill", () => {
  assert.deepEqual(
    GOOGLE_ANALYTICS_OAUTH_INPUT_REQUEST.fields.map((field) => [
      field.key,
      "envKey" in field.save ? field.save.envKey : null,
    ]),
    [
      ["clientId", "GOOGLE_ANALYTICS_CLIENT_ID"],
      ["clientSecret", "GOOGLE_ANALYTICS_CLIENT_SECRET"],
    ],
  );
  assert.ok(
    GOOGLE_ANALYTICS_OAUTH_INPUT_REQUEST.steps?.some((step) =>
      step.url?.includes("analyticsdata.googleapis.com"),
    ),
  );
  assert.doesNotMatch(
    GOOGLE_ANALYTICS_OAUTH_INPUT_REQUEST.reason ?? "",
    /Executor/,
  );
  assert.ok(
    GOOGLE_ANALYTICS_OAUTH_INPUT_REQUEST.steps?.some((step) =>
      step.url?.includes("analyticsadmin.googleapis.com"),
    ),
  );

  const task = integrationSetupTask({
    domain: "analytics.googleapis.com",
    name: "Google Analytics",
  });
  assert.match(task, /^@Setup, connect Google Analytics/u);
  assert.match(task, /attached setup skill/);
  assert.match(task, /operate the secure browser after I authenticate/);
  assert.ok(task.length < 300);
});

void test("onboarding Google Analytics actions own distinct Setup chats", () => {
  const actionId = "onboarding-google-analytics-workspace";
  const chatId = googleAnalyticsActionChatId(actionId);
  assert.equal(
    chatId,
    "integration-setup-action-onboarding-google-analytics-workspace",
  );
  assert.equal(googleAnalyticsActionIdFromChat(chatId), actionId);
  assert.equal(googleAnalyticsActionIdFromChat("ordinary-chat"), null);
  const directChatId = integrationSetupChatId("workspace-one", "pendo.io");
  assert.equal(directChatId, "integration-setup-v6-workspace-one--pendo.io");
  assert.equal(integrationSetupDomainFromChat(directChatId), "pendo.io");
  assert.notEqual(
    directChatId,
    integrationSetupChatId("workspace-two", "pendo.io"),
  );
});

void test("setup completion must match the requested integration", () => {
  assert.equal(
    setupResultMatchesIntegration(
      { provider: "google-analytics", status: "connected" },
      "analytics.googleapis.com",
    ),
    true,
  );
  assert.equal(
    setupResultMatchesIntegration(
      { provider: "pendo.io", status: "failed" },
      "pendo.io",
    ),
    false,
  );
  assert.equal(
    setupResultMatchesIntegration(
      { provider: "unrelated.example", status: "connected" },
      "pendo.io",
    ),
    false,
  );
});

void test("connected local providers match their setup catalog domains", () => {
  assert.equal(
    integrationProviderMatchesDomain(
      "google-analytics",
      "analytics.googleapis.com",
    ),
    true,
  );
  assert.equal(
    integrationProviderMatchesDomain(
      "gmail.googleapis.com",
      "gmail.googleapis.com",
    ),
    true,
  );
  assert.equal(
    integrationProviderMatchesDomain(
      "google-analytics",
      "gmail.googleapis.com",
    ),
    false,
  );
});

void test("setup markers never persist connection state", async () => {
  let writes = 0;
  await persistSetupResult(
    { provider: "pendo.io", status: "connected" },
    {
      markConnected: () => {
        writes += 1;
        return Promise.resolve();
      },
    },
  );
  assert.equal(writes, 0);
});

void test("generic setup remains concise and validates its domain", () => {
  const task = integrationSetupTask({ domain: "pendo.io", name: "Pendo" });
  assert.match(task, /^@Setup, connect Pendo/u);
  assert.doesNotMatch(task, /integrations\.sh|CHIEF_INPUT_REQUEST/u);
  assert.throws(
    () =>
      integrationSetupTask({
        domain: "pendo.io'; rm -rf ~",
        name: "Not Pendo",
      }),
    /domain is invalid/,
  );
});

void test("GitHub setup details stay out of the visible message", () => {
  const task = integrationSetupTask({ domain: "github.com", name: "GitHub" });
  assert.match(task, /^@Setup, connect GitHub/u);
  assert.doesNotMatch(task, /token form|repositories|permissions/u);
  assert.ok(task.length < 300);
});

void test("private setup instructions from legacy transcripts never render", () => {
  assert.equal(
    stripPrivateSetupInstructions(
      'Connect GitHub.\n\n<chief_setup_skill id="setup-github">\nSecret recipe\n</chief_setup_skill>',
    ),
    "Connect GitHub.",
  );
  assert.equal(
    stripPrivateSetupInstructions(
      "Before\n<chief_private_instructions>\nRuntime only\n</chief_private_instructions>\nAfter",
    ),
    "Before\n\nAfter",
  );
});

void test("setup results belong only to the latest connection attempt", () => {
  const message = (
    id: string,
    role: "user" | "assistant",
    text: string,
  ): ChiefUIMessage => ({ id, role, parts: [{ type: "text", text }] });
  const completed = [
    message("attempt-1", "user", `${SETUP_ATTEMPT_PREFIX}one]\nConnect it.`),
    message(
      "result-1",
      "assistant",
      'CHIEF_SETUP_RESULT {"provider":"google-analytics","status":"connected"}',
    ),
  ];

  assert.deepEqual(latestSetupAttempt(completed), {
    id: "one",
    result: { provider: "google-analytics", status: "connected" },
  });
  assert.deepEqual(
    latestSetupAttempt([
      ...completed,
      message(
        "attempt-2",
        "user",
        `${SETUP_ATTEMPT_PREFIX}two]\nReconnect it.`,
      ),
    ]),
    { id: "two", result: null },
  );
});
