import assert from "node:assert/strict";
import test from "node:test";

import {
  DEPLOYMENT_REQUIRED_MESSAGE,
  DeploymentNotFoundError,
  isDeploymentNotFound,
  safeRuntimeError,
} from "../src/deployment-failure.js";

void test("classifies only missing cloud deployments", () => {
  const missing = Object.assign(
    new Error("The deployment could not be found. DEPLOYMENT_NOT_FOUND syd1"),
    { status: 404 },
  );
  assert.equal(isDeploymentNotFound(missing), true);
  assert.equal(
    isDeploymentNotFound(new Error("outer", { cause: missing })),
    true,
  );
  assert.equal(isDeploymentNotFound(new DeploymentNotFoundError()), true);
  assert.equal(
    isDeploymentNotFound(
      Object.assign(new Error("Not found"), { status: 404 }),
    ),
    false,
  );
  assert.equal(isDeploymentNotFound(new Error("SESSION_NOT_FOUND")), false);
  assert.equal(safeRuntimeError(missing), DEPLOYMENT_REQUIRED_MESSAGE);
});
