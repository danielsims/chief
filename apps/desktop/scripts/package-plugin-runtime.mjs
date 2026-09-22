// Run runtime:bundle first. Produces an immutable release asset and pins its digest
// into the next desktop build. Uploading the asset is a separate release step.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { signDesktopRuntime } from "../../../packages/agent-runtime/scripts/sign-desktop-runtime.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauri = join(desktop, "src-tauri");
const target =
  process.env.TAURI_ENV_TARGET_TRIPLE ??
  execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(
    /^host: (.+)$/m,
  )?.[1];
if (!target || !/^[a-z0-9_-]+$/.test(target))
  throw new Error("Invalid runtime target");
if (process.platform === "darwin" && !process.env.APPLE_SIGNING_IDENTITY)
  throw new Error(
    "APPLE_SIGNING_IDENTITY is required for a macOS runtime release",
  );
const suffix = target.includes("windows") ? ".exe" : "";
const staging = mkdtempSync(join(tmpdir(), "chief-runtime-release-"));
const output = resolve(desktop, "../../.audit/runtime-release");
mkdirSync(output, { recursive: true });
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
  const archive = join(output, `chief-plugin-runtime-${target}.tar.gz`);
  execFileSync("tar", ["-czf", archive, "-C", staging, "."], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  const sha256 = createHash("sha256")
    .update(readFileSync(archive))
    .digest("hex");
  const tag = `plugin-runtime-${sha256.slice(0, 16)}`;
  const name = `chief-plugin-runtime-${target}-${sha256.slice(0, 16)}.tar.gz`;
  renameSync(archive, join(output, name));
  const manifestPath = join(tauri, "plugin-runtime-release.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest[target] = {
    url: `https://github.com/danielsims/chief/releases/download/${tag}/${name}`,
    sha256,
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    JSON.stringify({ tag, asset: join(output, name), sha256 }, null, 2),
  );
} finally {
  rmSync(staging, { recursive: true, force: true });
}
