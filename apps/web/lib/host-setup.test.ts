import assert from "node:assert/strict";
import test from "node:test";

import {
  canDeployHostSetup,
  cloudflareDeployArgs,
  cloudflareDeployVars,
  cloudflareSecretNames,
  defaultHostSetupDraft,
  hostAuthOrigin,
  hostPublicUrl,
  hostRelayConfig,
  hostRelayId,
  hostWorkerName,
  isHostSetupReady,
  parsePublicHostname,
  parseRelayName,
  providerCallbackUrl,
} from "./host-setup";

void test("accepts a public hostname and rejects cloud or loopback hosts", () => {
  assert.equal(parsePublicHostname("chief.example.com"), "chief.example.com");
  assert.equal(
    parsePublicHostname("https://Chief.Example.com/"),
    "chief.example.com",
  );
  assert.equal(parsePublicHostname("localhost"), null);
  assert.equal(parsePublicHostname("heychief.sh"), null);
  assert.equal(parsePublicHostname("relay.heychief.sh"), null);
  assert.equal(parsePublicHostname("chief.example.com/path"), null);
});

void test("slugs a relay name into a Cloudflare worker name", () => {
  assert.equal(parseRelayName("Acme"), "acme");
  assert.equal(parseRelayName("Northwind Labs"), "northwind-labs");
  assert.equal(parseRelayName("A"), null);
  assert.equal(hostWorkerName("acme"), "acme-chief");
  assert.equal(hostWorkerName("acme-chief"), "acme-chief");
  assert.equal(hostRelayId("northwind-labs"), "relay_northwind_labs");
});

void test("uses a custom domain when set, otherwise workers.dev", () => {
  const named = {
    ...defaultHostSetupDraft,
    host: "cloudflare" as const,
    name: "Acme",
  };
  assert.equal(hostPublicUrl(named), "");
  assert.equal(hostAuthOrigin(named), "https://acme-chief.workers.dev");
  assert.equal(
    hostPublicUrl({ customDomain: "chief.example.com" }),
    "https://chief.example.com",
  );
  assert.equal(
    hostAuthOrigin({ ...named, customDomain: "chief.example.com" }),
    "https://chief.example.com",
  );
});

void test("passes host form values through as Cloudflare deploy vars", () => {
  const draft = {
    ...defaultHostSetupDraft,
    apple: true,
    appleClientId: "sh.example.chief.web",
    customDomain: "chief.example.com",
    google: true,
    googleClientId: "google-client.apps.googleusercontent.com",
    host: "cloudflare" as const,
    name: "Acme",
  };
  assert.equal(canDeployHostSetup(draft), true);
  assert.deepEqual(cloudflareDeployVars(draft), {
    RELAY_DEPLOYMENT: "cloudflare-byoc",
    RELAY_ID: "relay_acme",
    AUTH_BASE_URL: "https://chief.example.com",
    AUTH_UI_ORIGIN: "https://chief.example.com",
    GOOGLE_CLIENT_ID: "google-client.apps.googleusercontent.com",
    AUTH_GOOGLE_REDIRECT_URI:
      "https://chief.example.com/api/auth/callback/google",
    APPLE_CLIENT_ID: "sh.example.chief.web",
    AUTH_APPLE_REDIRECT_URI:
      "https://chief.example.com/api/auth/callback/apple",
  });
  assert.deepEqual(cloudflareSecretNames(draft), [
    "BETTER_AUTH_SECRET",
    "GOOGLE_CLIENT_SECRET",
    "APPLE_CLIENT_SECRET",
  ]);
  assert.deepEqual(cloudflareDeployArgs(draft).slice(0, 2), [
    "--name",
    "acme-chief",
  ]);
  assert.deepEqual(hostRelayConfig(draft).authentication.methods, [
    "google",
    "apple",
  ]);
  assert.equal(
    providerCallbackUrl("https://chief.example.com", "apple"),
    "https://chief.example.com/api/auth/callback/apple",
  );
});

void test("does not deploy until the name, a provider, and a host are complete", () => {
  assert.equal(isHostSetupReady(defaultHostSetupDraft), false);
  assert.equal(canDeployHostSetup(defaultHostSetupDraft), false);
  const namedGoogle = {
    ...defaultHostSetupDraft,
    google: true,
    googleClientId: "google-client.apps.googleusercontent.com",
    name: "Acme",
  };
  assert.equal(isHostSetupReady(namedGoogle), true);
  assert.equal(canDeployHostSetup(namedGoogle), false);
  assert.equal(
    canDeployHostSetup({ ...namedGoogle, host: "cloudflare" }),
    true,
  );
  assert.equal(
    canDeployHostSetup({
      ...namedGoogle,
      customDomain: "heychief.sh",
      host: "cloudflare",
    }),
    false,
  );
});
