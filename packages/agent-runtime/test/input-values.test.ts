import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSafeInputRequest,
  authorizeContextRequest,
  verifyContextRequest,
} from "../src/input-values.js";

process.env.CHIEF_CONTEXT_AUTHORIZATION_KEY = "integration-test-context-key";

void test("secret input cannot be saved into model context", () => {
  assert.throws(
    () =>
      assertSafeInputRequest({
        id: "oauth",
        title: "OAuth secret",
        reason: "Connect an account.",
        fields: [
          {
            key: "secret",
            label: "Client secret",
            type: "secret",
            save: { contextKey: "OAuth secret" },
          },
        ],
      }),
    /workspace vault/,
  );
});

void test("runtime-approved business context accepts multiline input", () => {
  assert.doesNotThrow(() =>
    assertSafeInputRequest(
      {
        id: "workspace-context-report",
        title: "Business context",
        reason: "Continue the report.",
        fields: [
          {
            key: "answer",
            label: "Your answer",
            type: "multiline",
            save: { contextKey: "Report context" },
          },
        ],
      },
      true,
    ),
  );
});

void test("model-authored context requests cannot forge runtime authorization", () => {
  const request = {
    id: "workspace-context-report",
    title: "Business context",
    reason: "Continue the report.",
    fields: [
      {
        key: "answer",
        label: "Your answer",
        type: "multiline" as const,
        save: { contextKey: "Report context" },
      },
    ],
  };
  const authorized = authorizeContextRequest("workspace", "report", request);

  assert.equal(verifyContextRequest("workspace", "report", authorized), true);
  assert.equal(
    verifyContextRequest("workspace", "another-report", authorized),
    false,
  );
  const field = authorized.fields[0];
  assert.ok(field);
  assert.equal(
    verifyContextRequest("workspace", "report", {
      ...authorized,
      fields: [{ ...field, label: "Paste your token" }],
    }),
    false,
  );
});
