import assert from "node:assert/strict";
import test from "node:test";

import type { PluginAuthorizationAction } from "@chief/agent-runtime/types";

import {
  oauthClientCredentialError,
  oauthClientCredentialsAreComplete,
  oauthClientSetupGuide,
  oauthClientWizardSteps,
} from "../src/components/plugins/plugin-oauth-client-setup";

type OAuthClientAction = Extract<
  PluginAuthorizationAction,
  { kind: "plugin_oauth_client" }
>;

const githubAction: OAuthClientAction = {
  kind: "plugin_oauth_client",
  pluginId: "github",
  pluginName: "GitHub",
  description: "GitHub repositories",
  provider: "github.com",
  serverName: "github",
  callbackUrl: "http://127.0.0.1:4318/plugins/oauth/callback",
  setupUrl: "https://github.com/",
  status: "client_configuration_required",
};

void test("uses the same two-step OAuth client flow for every provider", () => {
  const guide = oauthClientSetupGuide(githubAction);
  const wizard = oauthClientWizardSteps(guide);

  assert.equal(guide.setupUrl, "https://github.com/");
  assert.equal(guide.setupLinkLabel, "Open GitHub");
  assert.equal(guide.logoDomain, "github.com");
  assert.match(guide.summary, /GitHub/);
  assert.doesNotMatch(guide.summary, /GitHub App/i);
  assert.equal(guide.callbackLabel, "Callback URL");
  assert.deepEqual(
    wizard.map((step) => step.id),
    ["register", "credentials"],
  );
  assert.match(wizard[0]?.description ?? "", /callback URL/i);
  assert.match(wizard[1]?.description ?? "", /client secret/i);
  assert.equal(
    guide.fields.find((field) => field.id === "clientSecret")?.required,
    false,
  );
  assert.equal(
    oauthClientCredentialError({
      guide,
      fieldId: "clientId",
      clientId: "",
      clientSecret: "",
    }),
    "Enter the client ID issued by the provider.",
  );
});

void test("keeps provider-specific setup URLs without changing the copy", () => {
  const guide = oauthClientSetupGuide({
    ...githubAction,
    pluginId: "example",
    pluginName: "Example",
    provider: "oauth.example.com",
    setupUrl: "https://oauth.example.com/apps/new",
  });
  const wizard = oauthClientWizardSteps(guide);

  assert.equal(guide.setupUrl, "https://oauth.example.com/apps/new");
  assert.equal(guide.setupLinkLabel, "Open Example");
  assert.match(guide.summary, /Example/);
  assert.deepEqual(
    wizard.map((step) => step.id),
    ["register", "credentials"],
  );
});

void test("requires every credential marked as required by the guide", () => {
  const guide = oauthClientSetupGuide(githubAction);

  assert.equal(
    oauthClientCredentialsAreComplete({
      guide,
      clientId: "",
      clientSecret: "client-secret",
    }),
    false,
  );
  assert.equal(
    oauthClientCredentialsAreComplete({
      guide,
      clientId: "client-id",
      clientSecret: "",
    }),
    true,
  );
});
