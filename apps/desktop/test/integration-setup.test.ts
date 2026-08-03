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
} from "../src/lib/integration-setup.ts";

void test("integration setup starts visibly in the getting-started channel", () => {
  const path = integrationSetupChannelPath(
    { domain: "github.com", name: "GitHub" },
    "attempt-one",
  );
  const url = new URL(path, "https://chief.local");
  assert.equal(url.searchParams.get("channel"), "getting-started");
  assert.equal(url.searchParams.get("chat"), null);
  assert.match(
    url.searchParams.get("prompt") ?? "",
    /^\[chief-integration-setup:attempt-one\]\n\n@Setup,/u,
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

void test("Google Analytics uses inline customer OAuth and broad Executor tools", () => {
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
  assert.match(task, /googleAnalytics\.authorize/);
  assert.match(task, /googleAnalytics\.complete/);
  assert.match(task, /localTools\.browserOpen/);
  assert.match(task, /googleOAuth\.provisionClient/);
  assert.match(task, /without exposing its ID or secret in chat/);
  assert.match(task, /googleOAuth\.captureClient/);
  assert.match(task, /client-created dialog or exact client's edit page/);
  assert.match(task, /Do not click Download JSON, OK/);
  assert.match(task, /Chief - Google Analytics/);
  assert.match(task, /never create another while an exact match exists/);
  assert.match(task, /Never ask them to tell you when they are ready/);
  assert.match(task, /Do not send the user into Google Cloud/);
  assert.match(task, /authoritative live report/);
  assert.doesNotMatch(task, /make one fresh read-only report/);
  assert.doesNotMatch(task, /gcloud auth|Application Default Credentials/);
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

void test("generic setup uses Executor handoffs without executing registry code", () => {
  const task = integrationSetupTask({ domain: "pendo.io", name: "Pendo" });
  assert.match(task, /integrations\.sh\/api\.json/);
  assert.match(task, /connection creation handoff/);
  assert.match(task, /OAuth-client creation handoff/);
  assert.match(task, /Connect action authorizes/);
  assert.match(task, /Do not ask for a second approval/);
  assert.match(task, /invalid setup response/);
  assert.match(task, /do not stop to wait for chat replies/);
  assert.doesNotMatch(task, /\bnpx\b|CHIEF_INPUT_REQUEST \{/);
  assert.throws(
    () =>
      integrationSetupTask({
        domain: "pendo.io'; rm -rf ~",
        name: "Not Pendo",
      }),
    /domain is invalid/,
  );
});

void test("GitHub setup makes Chief create a repository-scoped token", () => {
  const task = integrationSetupTask({ domain: "github.com", name: "GitHub" });
  assert.match(task, /After sign-in, you own the entire token form/);
  assert.match(task, /Chief - <repository name>/);
  assert.match(task, /today in YYYY-MM-DD/);
  assert.match(task, /90-day expiration/);
  assert.match(task, /Only select repositories/);
  assert.match(task, /Never choose All repositories/);
  assert.match(task, /Contents read and write/);
  assert.match(task, /Pull requests read and write/);
  assert.match(task, /open Add permissions/);
  assert.match(task, /shows Repositories \(3\)/);
  assert.match(task, /Never tell the human to create/);
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
