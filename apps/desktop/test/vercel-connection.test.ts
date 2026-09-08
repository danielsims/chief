import assert from "node:assert/strict";
import test from "node:test";

import {
  VERCEL_CONNECTION_PROMPT,
  VercelConnection,
} from "../src/components/vercel-connection.js";
import { providerCredentialHelp } from "../src/lib/provider-credential-help.js";

void test("agent deployment and workspace onboarding share one Vercel connection surface", () => {
  assert.equal(VercelConnection.name, "VercelConnection");
  assert.deepEqual(VERCEL_CONNECTION_PROMPT, {
    description: "Connect this workspace before continuing.",
    title: "Connect Vercel",
  });
});

void test("the AI Gateway connection points users directly to a key", () => {
  assert.deepEqual(providerCredentialHelp["vercel-ai-gateway-key"], {
    label: "Get a Vercel AI Gateway key",
    url: "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys&title=AI+Gateway+API+Keysin",
  });
});

void test("provider credential helpers use consistent access-token wording", () => {
  assert.equal(
    providerCredentialHelp["vercel-access-token"].label,
    "Get a Vercel access token",
  );
  assert.equal(
    providerCredentialHelp["opencode-access-token"].label,
    "Get an OpenCode access token",
  );
});
