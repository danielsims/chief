import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

import { eveDeploymentEnvironment } from "../src/deployments/vercel.js";

void test("Eve deployment uses Chief's packaged pnpm", () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-pnpm-"));
  const pnpmDirectory = join(directory, "pnpm", "bin");
  mkdirSync(pnpmDirectory, { recursive: true });
  writeFileSync(join(pnpmDirectory, "pnpm.cjs"), "");
  try {
    const environment = eveDeploymentEnvironment(directory, {
      PATH: "/usr/bin:/bin",
      VERCEL_TOKEN: "must-not-leak",
    });
    assert.equal(
      environment.npm_execpath,
      join(directory, "pnpm", "bin", "pnpm.cjs"),
    );
    assert.equal(
      environment.PATH,
      `${join(directory, ".bin")}${delimiter}/usr/bin:/bin`,
    );
    assert.equal(environment.VERCEL_TOKEN, undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("Eve deployment fails clearly when packaged pnpm is missing", () => {
  assert.throws(
    () => eveDeploymentEnvironment("/missing-chief-runtime", {}),
    /packaged pnpm installer is unavailable/,
  );
});
