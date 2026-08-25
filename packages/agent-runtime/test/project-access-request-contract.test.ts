import assert from "node:assert/strict";
import test from "node:test";

import { localToolsOpenApi } from "../src/local-tools.js";
import { requestProjectAccessInputSchema } from "../src/tools/toolkits/projects/request-project-access.js";

void test("project access requests expose one explicit capability batch", () => {
  const specification = localToolsOpenApi("http://127.0.0.1:4318");
  const operation =
    specification.paths["/local-tools/projects/access-request"]?.post;
  assert.ok(operation);
  const serialized = JSON.stringify(operation);
  assert.match(serialized, /all required project scopes/u);
  assert.match(serialized, /capabilities/u);
  assert.match(
    serialized,
    /view.*checkout.*commit.*publish.*review.*administer/u,
  );
});

void test("project access request parsing keeps every unique scope", () => {
  const parsed = requestProjectAccessInputSchema.parse({
    projectId: "project-a",
    capabilities: ["view", "checkout", "commit", "commit"],
  });
  assert.deepEqual(parsed, {
    projectId: "project-a",
    capabilities: ["view", "checkout", "commit"],
  });
  assert.equal(
    requestProjectAccessInputSchema.safeParse({
      projectId: "project-a",
      capability: "commit",
    }).success,
    false,
  );
});
