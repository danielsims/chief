import assert from "node:assert/strict";
import test from "node:test";

import {
  ConvexDeploymentProvider,
  convexTeamSlugs,
} from "../src/deployments/convex.js";
import { DeploymentNeedsConfigurationError } from "../src/deployments/types.js";

void test("Convex provider reports missing Keychain Gateway configuration precisely", async () => {
  const provider = new ConvexDeploymentProvider();
  await assert.rejects(
    provider.deploy(
      {
        workspaceId: "workspace-1",
        projectName: "chief-test",
        workspaceRoot: "/does/not/matter",
        runtimeModules: "/does/not/matter",
        routePassword: "not-a-real-secret",
        model: "anthropic/claude-sonnet-4.6",
        environment: {},
      },
      {
        phase: () => undefined,
        log: () => undefined,
        process: () => undefined,
        canceled: () => false,
      },
    ),
    (error: unknown) =>
      error instanceof DeploymentNeedsConfigurationError &&
      error.message.includes("AI_GATEWAY_API_KEY"),
  );
});

void test("Convex provider rejects names the Convex CLI cannot provision", async () => {
  const provider = new ConvexDeploymentProvider();
  await assert.rejects(
    provider.deploy(
      {
        workspaceId: "workspace-1",
        projectName: "bad.name",
        workspaceRoot: "/does/not/matter",
        runtimeModules: "/does/not/matter",
        routePassword: "not-a-real-secret",
        model: "anthropic/claude-sonnet-4.6",
        environment: { AI_GATEWAY_API_KEY: "not-a-real-key" },
      },
      {
        phase: () => undefined,
        log: () => undefined,
        process: () => undefined,
        canceled: () => false,
      },
    ),
    /lowercase letters, numbers, and hyphens/,
  );
});

void test("Convex provider reads team slugs from CLI status output", () => {
  assert.deepEqual(
    convexTeamSlugs(
      `Status: Logged in\nTeams: 1 team accessible\n  - Daniel's team (daniel-123)`,
    ),
    ["daniel-123"],
  );
});
