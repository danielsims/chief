import assert from "node:assert/strict";
import test from "node:test";

import { machineListIsLoading } from "../src/lib/relay-machines.js";

void test("cached machines never leave the list in its loading state", () => {
  assert.equal(machineListIsLoading("workspace-one", true, true), false);
});

void test("an uncached workspace loads until its request settles", () => {
  assert.equal(machineListIsLoading("workspace-one", false, true), true);
  assert.equal(machineListIsLoading("workspace-one", false, false), false);
});

void test("the machine list does not load without a workspace", () => {
  assert.equal(machineListIsLoading(undefined, false, true), false);
});
