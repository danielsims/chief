// Runs before every desktop build. Release builds package the plugin runtime as an
// asset of the same `v{version}` GitHub release (Forge uploads everything under
// `src-tauri/target/release-assets`) and pin its URL and digest into the app.
// `--clear` builds pin nothing: offline builds bundle the runtime instead.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { signDesktopRuntime } from "../../../packages/agent-runtime/scripts/sign-desktop-runtime.mjs";

// Targets with a tested on-demand runtime. Others report local plugins as unavailable.
const SUPPORTED = new Set(["aarch64-apple-darwin"]);

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauri = join(desktop, "src-tauri");
const manifestPath = join(tauri, "plugin-runtime-release.json");
const writeManifest = (manifest) =>
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// Never let a previous build's pin leak into this one.
writeManifest({});
if (process.argv.includes("--clear")) process.exit(0);

const target =
  process.env.TAURI_ENV_TARGET_TRIPLE ??
  execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(
    /^host: (.+)$/m,
  )?.[1];
if (!target || !/^[a-z0-9_-]+$/.test(target))
  throw new Error("Invalid runtime target");
if (!SUPPORTED.has(target)) {
  console.log(`No on-demand plugin runtime for ${target}.`);
  process.exit(0);
}
if (process.platform === "darwin" && !process.env.APPLE_SIGNING_IDENTITY)
  throw new Error(
    "APPLE_SIGNING_IDENTITY is required for a macOS runtime release",
  );

const { version } = JSON.parse(
  readFileSync(join(tauri, "tauri.conf.json"), "utf8"),
);
const platform = target.includes("apple")
  ? "macos"
  : target.includes("windows")
    ? "windows"
    : "linux";
const suffix = platform === "windows" ? ".exe" : "";
const output = join(tauri, "target/release-assets", platform);
const name = `chief-plugin-runtime-${version}-${target}.tar.gz`;

execFileSync("pnpm", ["runtime:bundle"], { cwd: desktop, stdio: "inherit" });
mkdirSync(output, { recursive: true });
const staging = mkdtempSync(join(tmpdir(), "chief-runtime-release-"));
try {
  cpSync(
    join(tauri, "resources/agent-runtime"),
    join(staging, "agent-runtime"),
    { recursive: true },
  );
  cpSync(
    join(tauri, `binaries/chief-agent-runtime-${target}${suffix}`),
    join(staging, `chief-agent-runtime${suffix}`),
  );
  // Keep Node's third-party notices with the redistributed binary.
  cpSync(
    resolve(dirname(process.execPath), "../LICENSE"),
    join(staging, "NODE-LICENSE"),
  );
  cpSync(resolve(desktop, "../../LICENSE"), join(staging, "LICENSE"));
  signDesktopRuntime(
    staging,
    process.env.APPLE_SIGNING_IDENTITY,
    join(tauri, "Entitlements.plist"),
  );
  const archive = join(output, name);
  execFileSync("tar", ["-czf", archive, "-C", staging, "."], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  const sha256 = createHash("sha256")
    .update(readFileSync(archive))
    .digest("hex");
  writeManifest({
    [target]: {
      url: `https://github.com/danielsims/chief/releases/download/v${version}/${name}`,
      sha256,
    },
  });
  console.log(`Packaged ${name} (${sha256}).`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
