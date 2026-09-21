#!/usr/bin/env node
// Deploys the relay, supplying Apple identifiers from the environment.
//
// Those identifiers are not committed because they belong to whoever builds
// the iOS client. A deploy without them is valid: the relay simply sends no
// push notifications.
import { spawn } from "node:child_process";

const bundleId =
  process.env.CHIEF_BUNDLE_ID || process.env.CHIEF_APPLE_BUNDLE_ID;

const vars = {
  APNS_TEAM_ID: process.env.CHIEF_APPLE_TEAM_ID,
  APNS_BUNDLE_ID: bundleId,
  APPLE_APP_BUNDLE_IDENTIFIER: bundleId,
};

const args = ["wrangler", "deploy", ...process.argv.slice(2)];
const missing = [];

for (const [key, value] of Object.entries(vars)) {
  if (value) {
    args.push("--var", `${key}:${value}`);
  } else {
    missing.push(key);
  }
}

if (missing.length > 0) {
  console.warn(
    `[relay:deploy] No value for ${missing.join(", ")}. Push requires CHIEF_APPLE_TEAM_ID, CHIEF_BUNDLE_ID, and the APNS_KEY_ID/APNS_P8 secrets.`,
  );
}

const child = spawn("pnpm", ["exec", ...args], {
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code) => process.exit(code ?? 1));

child.on("error", (error) => {
  console.error(`[relay:deploy] ${error.message}`);
  process.exit(1);
});
