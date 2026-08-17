import assert from "node:assert/strict";
import test from "node:test";

import type { ProjectGitService } from "../src/projects/git-service.js";
import {
  handleProjectLocalTool,
  projectOpenApiPaths,
  projectOpenApiSchemas,
} from "../src/projects/local-tools.js";

void test("project access requests expose one explicit capability batch", () => {
  assert.deepEqual(projectOpenApiSchemas.ProjectAccessRequestInput.required, [
    "projectId",
    "capabilities",
  ]);
  assert.equal(
    projectOpenApiSchemas.ProjectAccessRequestInput.properties.capabilities
      .type,
    "array",
  );
  assert.equal(
    projectOpenApiSchemas.ProjectAccessRequestInput.properties.capabilities
      .minItems,
    1,
  );
  assert.deepEqual(
    projectOpenApiSchemas.ProjectAccessRequestInput.properties.capabilities
      .items.enum,
    ["view", "checkout", "commit", "publish", "review", "administer"],
  );

  const paths = projectOpenApiPaths((schema) => ({ schema }));
  const operation = paths["/local-tools/projects/access-request"].post;
  assert.match(operation.summary, /all required project scopes/u);
  assert.match(
    operation.description,
    /"capabilities":\["view","checkout","commit"\]/u,
  );
  assert.deepEqual(operation.requestBody, {
    schema: "ProjectAccessRequestInput",
  });
});

void test("project access requests pass every scope through one tool call", async () => {
  let requested: readonly string[] = [];
  let changes = 0;
  const service = {
    administration: {
      requestProjectAccess: (
        organizationId: string,
        projectId: string,
        agentId: string,
        capabilities: readonly string[],
      ) => {
        assert.equal(organizationId, "workspace-a");
        assert.equal(projectId, "project-a");
        assert.equal(agentId, "engineer");
        requested = capabilities;
        return {
          id: "request-a",
          organizationId,
          projectId,
          agentId,
          capabilities,
          status: "pending",
          requestedAt: 1,
        };
      },
    },
  } as unknown as ProjectGitService;
  const request = new Request(
    "http://localhost/local-tools/projects/access-request",
    { method: "POST" },
  );

  const result = await handleProjectLocalTool(
    request,
    {
      projectId: "project-a",
      capabilities: ["view", "checkout", "commit"],
    },
    {
      service,
      organizationId: "workspace-a",
      agentId: "engineer",
      onProjectsChanged: () => {
        changes += 1;
      },
    },
  );

  assert.deepEqual(requested, ["view", "checkout", "commit"]);
  assert.equal(changes, 1);
  assert.deepEqual(result, {
    handled: true,
    value: {
      status: "pending",
      requestId: "request-a",
      capabilities: ["view", "checkout", "commit"],
      message:
        "Access requested for view, checkout, commit. A workspace operator must approve this request before those scopes take effect; retry the blocked operation afterward.",
    },
  });

  await assert.rejects(
    handleProjectLocalTool(
      request,
      { projectId: "project-a", capability: "commit" },
      { service, organizationId: "workspace-a", agentId: "engineer" },
    ),
    /capabilities must be a non-empty array/u,
  );
});
