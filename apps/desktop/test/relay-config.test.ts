import assert from "node:assert/strict";
import test from "node:test";

import {
  CHIEF_CLOUD_RELAY_URL,
  desktopRelayConfiguration,
} from "../src/lib/relay-config";

void test("a local development default never becomes Chief Cloud's identity", () => {
  const local = desktopRelayConfiguration(
    {
      VITE_CHIEF_RELAY_URL: "http://localhost:8080",
      VITE_AUTH_BASE_URL: "http://localhost:8080",
      VITE_AUTH_UI_URL: "http://localhost:8080",
    },
    null,
  );
  assert.deepEqual(local, {
    relayUrl: "http://localhost:8080",
    authBaseUrl: "http://localhost:8080",
    authUiUrl: "http://localhost:8080",
  });
  assert.equal(CHIEF_CLOUD_RELAY_URL, "https://relay.heychief.sh");
  assert.notEqual(local.relayUrl, CHIEF_CLOUD_RELAY_URL);
});

void test("explicit relay selection overrides the default without changing Chief Cloud", () => {
  const selected = {
    version: 1 as const,
    relayUrl: "https://team.example",
    authBaseUrl: "https://team.example",
    authUiUrl: "https://team.example",
  };
  assert.deepEqual(
    desktopRelayConfiguration(
      { VITE_CHIEF_RELAY_URL: "http://localhost:8080" },
      selected,
    ),
    {
      relayUrl: selected.relayUrl,
      authBaseUrl: selected.authBaseUrl,
      authUiUrl: selected.authUiUrl,
    },
  );
  assert.equal(
    desktopRelayConfiguration({}, null).relayUrl,
    CHIEF_CLOUD_RELAY_URL,
  );
});
