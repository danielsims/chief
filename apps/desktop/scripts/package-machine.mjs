// Runs before every desktop build. Release builds (those signing for macOS)
// also build `chief-machine` for each supported machine and leave the binaries,
// each with a `.sha256`, in `src-tauri/target/release-assets`, which Forge
// uploads to the same `v{version}` GitHub release. The relay's install script
// downloads them from there. Linux and Windows are cross-compiled with
// cargo-zigbuild, so the whole set builds on the Mac.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const targets = [
  { target: "aarch64-apple-darwin", platform: "macos", zig: false },
  { target: "x86_64-apple-darwin", platform: "macos", zig: false },
  { target: "aarch64-unknown-linux-musl", platform: "linux", zig: true },
  { target: "armv7-unknown-linux-musleabihf", platform: "linux", zig: true },
  { target: "x86_64-unknown-linux-musl", platform: "linux", zig: true },
  { target: "x86_64-pc-windows-gnu", platform: "windows", zig: true },
];

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauri = join(desktop, "src-tauri");
const crate = resolve(desktop, "../../packages/chief-machine");

const identity = process.env.APPLE_SIGNING_IDENTITY;
if (process.platform !== "darwin" || !identity) {
  console.log("Not a signed macOS release build; skipping chief-machine.");
  process.exit(0);
}

const { version } = JSON.parse(
  readFileSync(join(tauri, "tauri.conf.json"), "utf8"),
);

for (const { target, platform, zig } of targets) {
  execFileSync(
    "cargo",
    [
      zig ? "zigbuild" : "build",
      "--release",
      "--features",
      "cli",
      "--target",
      target,
    ],
    { cwd: crate, stdio: "inherit" },
  );
  const suffix = platform === "windows" ? ".exe" : "";
  const built = join(
    crate,
    "target",
    target,
    "release",
    `chief-machine${suffix}`,
  );
  const output = join(tauri, "target/release-assets", platform);
  const name = `chief-machine-${version}-${target}${suffix}`;
  mkdirSync(output, { recursive: true });
  copyFileSync(built, join(output, name));
  if (platform === "macos")
    execFileSync("codesign", [
      "--force",
      "--options",
      "runtime",
      "--sign",
      identity,
      join(output, name),
    ]);
  const sha256 = createHash("sha256")
    .update(readFileSync(join(output, name)))
    .digest("hex");
  writeFileSync(join(output, `${name}.sha256`), `${sha256}  ${name}\n`);
  console.log(`Packaged ${name} (${sha256}).`);
}
