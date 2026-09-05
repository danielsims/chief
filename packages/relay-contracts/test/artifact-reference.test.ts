import assert from "node:assert/strict";
import { test } from "node:test";

import {
  artifactMessageComponents,
  channelArtifactPath,
  messageComponentSchema,
  workspaceFileSchema,
} from "../src/index";

const file = workspaceFileSchema.parse({
  id: "plan",
  path: "plan.html",
  title: "Growth plan",
  mimeType: "text/html",
  content: "<h1>Plan</h1>",
  conversationId: "marketing",
  authorAgentId: "chief",
  version: 2,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
void test("artifact references resolve real versions and reject cross-channel or missing files", () => {
  const parts = artifactMessageComponents(
    [file.id, file.id],
    [file],
    "marketing",
  );
  assert.equal(parts.length, 1);
  assert.deepEqual(messageComponentSchema.parse(parts[0]).payload, {
    fileId: "plan",
    title: "Growth plan",
    mimeType: "text/html",
    conversationId: "marketing",
    version: 2,
  });
  assert.throws(() => artifactMessageComponents([file.id], [file], "general"));
  assert.throws(() =>
    artifactMessageComponents(["missing"], [file], "marketing"),
  );
  assert.throws(() =>
    messageComponentSchema.parse({ ...parts[0], version: 2 }),
  );
});
void test("artifact links keep identifiers in encoded query values", () => {
  const link = new URL(
    channelArtifactPath("marketing", "plan&view=messages"),
    "https://chief.test",
  );
  assert.equal(link.searchParams.get("view"), "canvas");
  assert.equal(link.searchParams.get("artifact"), "plan&view=messages");
});
