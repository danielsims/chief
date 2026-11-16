#!/usr/bin/env node
// Local review packages stay lightweight; --offline explicitly embeds a runtime.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--offline"))
  throw new Error("Usage: pnpm desktop:dmg [--offline]");
const offline = args.includes("--offline");
const config = offline
  ? "src-tauri/tauri.offline.conf.json"
  : "src-tauri/tauri.local.conf.json";
const appBundle = join(
  repoRoot,
  "apps/desktop/src-tauri/target/release/bundle/macos/Chief.app",
);
const dmgDirectory = join(
  repoRoot,
  "apps/desktop/src-tauri/target/release/bundle/dmg",
);

let identity =
  process.env.CHIEF_APPLE_SIGNING_IDENTITY?.trim() ||
  process.env.APPLE_SIGNING_IDENTITY?.trim();
if (!identity && process.platform === "darwin") {
  const installed = execFileSync(
    "security",
    ["find-identity", "-v", "-p", "codesigning"],
    { encoding: "utf8" },
  );
  const developerIds = [
    ...installed.matchAll(/\b([A-F0-9]{40}) "Developer ID Application:[^"]+"/g),
  ];
  if (developerIds.length === 1) identity = developerIds[0][1];
}
if (!identity || identity === "-") {
  throw new Error(
    "Set CHIEF_APPLE_SIGNING_IDENTITY to a Developer ID identity. Local DMGs require coherent signing for native runtime libraries; ad-hoc signing is not supported by this packaging command.",
  );
}
const buildEnv = { ...process.env, APPLE_SIGNING_IDENTITY: identity };
function run(command, commandArgs, env = buildEnv) {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    cwd: repoRoot,
    env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Verify the complete signed app before making its installer. Keep the runtime
// outside a normal DMG and pin the exact published archive the app will install.
run("pnpm", [
  "--filter",
  "@chief/desktop",
  "tauri",
  "build",
  "--config",
  config,
  "--bundles",
  "app",
]);
run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appBundle]);
run("pnpm", ["--filter", "@chief/desktop", "verify:packaged-plugin-host"]);
if (
  !offline &&
  existsSync(join(appBundle, "Contents/MacOS/chief-agent-runtime"))
) {
  throw new Error(
    "Lightweight app unexpectedly embeds Node; refusing to package it.",
  );
}
run("pnpm", [
  "--filter",
  "@chief/desktop",
  "tauri",
  "bundle",
  "--config",
  config,
  "--bundles",
  "dmg",
]);
// Older versions' images stay in this folder, so name only the one just built.
const [built] = readdirSync(dmgDirectory)
  .filter((name) => /^Chief_.*\.dmg$/.test(name))
  .map((name) => join(dmgDirectory, name))
  .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
if (!built) throw new Error(`No DMG was built in ${dmgDirectory}.`);
console.log(`DMG: ${built}`);
