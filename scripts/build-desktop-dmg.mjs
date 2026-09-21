#!/usr/bin/env node
// Builds and signs the desktop DMG.
//
// The Developer ID name and team identifier are read from the environment
// rather than committed, because they identify a real Apple account. Set:
//
//   CHIEF_APPLE_SIGNING_IDENTITY   e.g. "Developer ID Application: Name (TEAMID)"
//
// A build without it still produces an unsigned bundle, which is fine for
// local testing.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const identity =
  process.env.CHIEF_APPLE_SIGNING_IDENTITY ||
  process.env.APPLE_SIGNING_IDENTITY;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(command, env) {
  const result = spawnSync(command, {
    stdio: "inherit",
    shell: true,
    cwd: repoRoot,
    env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Tauri reads APPLE_SIGNING_IDENTITY from the environment itself; it is not a
// config key. Pass it through so a signed build stays signed.
const buildEnv = { ...process.env };
if (identity) {
  buildEnv.APPLE_SIGNING_IDENTITY = identity;
} else {
  console.warn(
    "[desktop:dmg] CHIEF_APPLE_SIGNING_IDENTITY is unset; the bundle will be unsigned.",
  );
}

run("pnpm --filter @chief/desktop build:app:offline", buildEnv);

if (identity) {
  run(
    'codesign --verify --deep --strict --verbose=2 "apps/desktop/src-tauri/target/release/bundle/macos/Chief.app"',
    process.env,
  );
}

run("pnpm --filter @chief/desktop verify:packaged-plugin-host", process.env);
run(
  "open -R apps/desktop/src-tauri/target/release/bundle/dmg/Chief_*.dmg",
  process.env,
);
