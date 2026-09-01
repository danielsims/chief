import assert from "node:assert/strict";
import test from "node:test";

import type { PluginAuthorizationAction } from "@chief/agent-runtime/types";

import {
  oauthClientCredentialError,
  oauthClientCredentialsAreComplete,
  oauthClientSetupGuide,
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
  provider: "GitHub",
  serverName: "github",
  callbackUrl: "http://127.0.0.1:4318/plugins/oauth/callback",
  status: "client_configuration_required",
};

void test("provides authoritative GitHub App instructions", () => {
  const guide = oauthClientSetupGuide(githubAction);

  assert.equal(guide.setupUrl, "https://github.com/settings/apps/new");
  assert.equal(
    guide.documentationUrl,
    "https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app",
  );
  assert.equal(guide.logoDomain, "github.com");
  assert.match(guide.summary, /workspace relay/i);
  assert.equal(guide.callbackLabel, "Callback URL");
  assert.match(guide.steps[1]?.description ?? "", /user authorization/i);
  assert.match(
    guide.steps[2]?.description ?? "",
    /choose only the repositories/i,
  );
  assert.match(guide.steps[3]?.description ?? "", /remote GitHub MCP server/i);
  assert.match(guide.configurationNotice ?? "", /Chief Cloud/i);
  assert.match(guide.configurationNotice ?? "", /never paste/i);
  assert.ok(guide.providerFormFields);
  assert.deepEqual(
    guide.providerFormFields.map((field) => field.label),
    ["GitHub App name", "Homepage URL", "Callback URL", "User authorization"],
  );
  assert.equal(
    guide.providerFormFields.find((field) => field.label === "Homepage URL")
      ?.guidance,
    "https://heychief.sh",
  );
  assert.equal(
    guide.fields.find((field) => field.id === "clientSecret")?.required,
    true,
  );
  assert.equal(
    oauthClientCredentialError({
      guide,
      fieldId: "clientSecret",
      clientId: "client-id",
      clientSecret: "",
    }),
    "Generate and enter a GitHub client secret.",
  );
});

void test("uses action metadata for providers without a tailored guide", () => {
  const guide = oauthClientSetupGuide({
    ...githubAction,
    pluginId: "example",
    pluginName: "Example",
    provider: "oauth.example.com",
    setupUrl: "https://oauth.example.com/apps/new",
  });

  assert.equal(guide.setupUrl, "https://oauth.example.com/apps/new");
  assert.match(guide.summary, /Example/);
  assert.equal(
    guide.fields.find((field) => field.id === "clientSecret")?.required,
    false,
  );
});

void test("requires every credential marked as required by the guide", () => {
  const guide = oauthClientSetupGuide(githubAction);

  assert.equal(
    oauthClientCredentialsAreComplete({
      guide,
      clientId: "client-id",
      clientSecret: "",
    }),
    false,
  );
  assert.equal(
    oauthClientCredentialsAreComplete({
      guide,
      clientId: "client-id",
      clientSecret: "client-secret",
    }),
    true,
  );
});
