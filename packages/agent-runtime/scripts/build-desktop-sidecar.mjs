import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

import { signDesktopRuntime } from "./sign-desktop-runtime.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");
const tauriRoot = join(repoRoot, "apps/desktop/src-tauri");
const runtimeRoot = join(tauriRoot, "resources/agent-runtime");
const runtimeVersionFile = join(tauriRoot, "resources/agent-runtime.version");
const binariesRoot = join(tauriRoot, "binaries");
const macEntitlements = join(tauriRoot, "Entitlements.plist");
const packageRequire = createRequire(join(packageRoot, "package.json"));

function expectedNodeVersion() {
  return readFileSync(join(repoRoot, ".nvmrc"), "utf8")
    .trim()
    .replace(/^v/, "");
}

function targetRuntime(target) {
  const platform = target.includes("apple-darwin")
    ? "darwin"
    : target.includes("windows")
      ? "win32"
      : target.includes("linux")
        ? "linux"
        : undefined;
  const arch = /^(aarch64|arm64)-/.test(target)
    ? "arm64"
    : /^(x86_64|x64)-/.test(target)
      ? "x64"
      : undefined;
  if (!platform || !arch) {
    throw new Error(`Unsupported sidecar target: ${target}`);
  }
  return { arch, platform };
}

function inspectNodeBinary(path) {
  try {
    return JSON.parse(
      execFileSync(
        path,
        [
          "-p",
          "JSON.stringify({version:process.versions.node,arch:process.arch,platform:process.platform})",
        ],
        { encoding: "utf8" },
      ),
    );
  } catch (error) {
    throw new Error(`Could not execute Node sidecar at ${path}`, {
      cause: error,
    });
  }
}

function hostTriple() {
  const output = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const host = output.match(/^host: (.+)$/m)?.[1];
  if (!host) throw new Error("Could not determine the Rust host target.");
  return host.trim();
}

function hashFile(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(path);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

function packageDirectory(manifestPath) {
  return dirname(manifestPath);
}

function copyPackage(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

function libsqlTarget(target, runtime) {
  if (runtime.platform === "darwin") return `darwin-${runtime.arch}`;
  if (runtime.platform === "win32") return `win32-${runtime.arch}-msvc`;
  const libc = target.includes("musl") ? "musl" : "gnu";
  return `linux-${runtime.arch}-${libc}`;
}

function browserTarget(target, runtime) {
  const platform =
    runtime.platform === "linux" && target.includes("musl")
      ? "linux-musl"
      : runtime.platform;
  return `agent-browser-${platform}-${runtime.arch}${runtime.platform === "win32" ? ".exe" : ""}`;
}

const target = process.env.TAURI_ENV_TARGET_TRIPLE ?? hostTriple();
const nodeBinary = resolve(process.env.CHIEF_NODE_BINARY ?? process.execPath);
if (!existsSync(nodeBinary)) {
  throw new Error(`Node sidecar not found at ${nodeBinary}`);
}
const expectedVersion = expectedNodeVersion();
if (process.versions.node !== expectedVersion) {
  throw new Error(
    `Sidecar build requires Node ${expectedVersion}; running ${process.versions.node} from ${process.execPath}`,
  );
}
const expectedRuntime = targetRuntime(target);
const selectedNode = inspectNodeBinary(nodeBinary);
if (selectedNode.version !== expectedVersion) {
  throw new Error(
    `Node sidecar must be ${expectedVersion}; ${nodeBinary} is ${selectedNode.version}`,
  );
}
if (
  selectedNode.arch !== expectedRuntime.arch ||
  selectedNode.platform !== expectedRuntime.platform
) {
  throw new Error(
    `Node sidecar ${selectedNode.platform}/${selectedNode.arch} does not match target ${target} (${expectedRuntime.platform}/${expectedRuntime.arch})`,
  );
}
console.log(
  `Selected Node ${selectedNode.version} (${selectedNode.platform}/${selectedNode.arch}) at ${nodeBinary} for ${target}.`,
);

rmSync(runtimeRoot, { recursive: true, force: true });
mkdirSync(join(runtimeRoot, "dist"), { recursive: true });

// The packaged desktop starts only the signed relay-cell and plugin-host workers.
// Bundle their JS graphs instead of deploying the complete development workspace.
// ws remains external because it is CommonJS; libsql's target-native binding is
// copied below. The createRequire banner lets bundled CommonJS dependencies use
// Node built-ins from an ESM entrypoint.
const nativeLibsqlPackage = `@libsql/${libsqlTarget(target, expectedRuntime)}`;
await build({
  banner: {
    js: "import { createRequire as __chiefCreateRequire } from 'node:module'; const require = __chiefCreateRequire(import.meta.url);",
  },
  bundle: true,
  entryPoints: [
    join(packageRoot, "src/relay-cell-worker.ts"),
    join(packageRoot, "src/plugin-host-worker.ts"),
  ],
  entryNames: "[name]",
  external: ["ws", nativeLibsqlPackage],
  format: "esm",
  logLevel: "warning",
  outExtension: { ".js": ".mjs" },
  outdir: join(runtimeRoot, "dist"),
  platform: "node",
  plugins: [
    {
      name: "bundle-chief-relay-packages",
      setup(build) {
        build.onResolve({ filter: /^zod$/ }, ({ importer }) =>
          importer.startsWith(resolve(packageRoot, "../relay-contracts"))
            ? {
                path: resolve(
                  packageRoot,
                  "../relay-contracts/node_modules/zod/index.js",
                ),
              }
            : undefined,
        );
        build.onResolve({ filter: /^@chief\/browser\/node$/ }, () => ({
          path: join(repoRoot, "packages/browser/src/node.ts"),
        }));
        build.onResolve({ filter: /^@chief\/relay-client$/ }, () => ({
          path: join(repoRoot, "packages/relay-client/src/index.ts"),
        }));
        build.onResolve({ filter: /^@chief\/relay-contracts$/ }, () => ({
          path: join(repoRoot, "packages/relay-contracts/src/index.ts"),
        }));
      },
    },
  ],
  target: "node24",
});

copyPackage(
  packageDirectory(packageRequire.resolve("ws/package.json")),
  join(runtimeRoot, "node_modules/ws"),
);

const libsqlClientEntry = packageRequire.resolve("@libsql/client");
const libsqlRequire = createRequire(libsqlClientEntry);
const libsqlEntry = libsqlRequire.resolve("libsql");
const nativeLibsqlRequire = createRequire(libsqlEntry);
copyPackage(
  packageDirectory(
    nativeLibsqlRequire.resolve(`${nativeLibsqlPackage}/package.json`),
  ),
  join(runtimeRoot, "node_modules", nativeLibsqlPackage),
);

// Browser automation needs one tiny JS launcher and one target-native client.
// Do not ship the six binaries for platforms this build cannot run on.
const browserRequire = createRequire(
  join(repoRoot, "packages/browser/package.json"),
);
const browserRoot = packageDirectory(
  browserRequire.resolve("agent-browser/package.json"),
);
const browserBinary = browserTarget(target, expectedRuntime);
const bundledBrowserRoot = join(runtimeRoot, "node_modules/agent-browser");
mkdirSync(join(bundledBrowserRoot, "bin"), { recursive: true });
copyFileSync(
  join(browserRoot, "package.json"),
  join(bundledBrowserRoot, "package.json"),
);
copyFileSync(
  join(browserRoot, "bin/agent-browser.js"),
  join(bundledBrowserRoot, "bin/agent-browser.js"),
);
copyFileSync(
  join(browserRoot, "bin", browserBinary),
  join(bundledBrowserRoot, "bin", browserBinary),
);
if (expectedRuntime.platform !== "win32") {
  chmodSync(join(bundledBrowserRoot, "bin", browserBinary), 0o755);
}

// Prompts and bundled plugin metadata remain filesystem assets shared by every
// provider. Provider CLIs are discovered from the user's machine.
copyPackage(join(packageRoot, "src/agents"), join(runtimeRoot, "agents"));
copyPackage(join(packageRoot, "drizzle"), join(runtimeRoot, "drizzle"));
const bundledPluginsRoot = join(packageRoot, "src/plugins-bundled");
if (existsSync(bundledPluginsRoot)) {
  copyPackage(bundledPluginsRoot, join(runtimeRoot, "plugins-bundled"));
}

mkdirSync(binariesRoot, { recursive: true });
const sidecarName = `chief-agent-runtime-${target}${process.platform === "win32" ? ".exe" : ""}`;
const sidecarPath = join(binariesRoot, sidecarName);
const stagedSidecarPath = `${sidecarPath}.next`;
copyFileSync(nodeBinary, stagedSidecarPath);
chmodSync(stagedSidecarPath, 0o755);
renameSync(stagedSidecarPath, sidecarPath);

// Smoke-load the exact packaged worker before Tauri spends time constructing
// an installer. A disabled config exits after all imports and native bindings
// have loaded without opening a relay connection.
const smokeRoot = mkdtempSync(join(tmpdir(), "chief-agent-runtime-"));
try {
  execFileSync(
    sidecarPath,
    [join(runtimeRoot, "dist/relay-cell-worker.mjs"), "smoke"],
    {
      cwd: runtimeRoot,
      env: { ...process.env, CHIEF_CELL_ROOT: smokeRoot },
      stdio: "inherit",
    },
  );
} finally {
  rmSync(smokeRoot, { recursive: true, force: true });
}
execFileSync(sidecarPath, [join(runtimeRoot, "dist/plugin-host-worker.mjs")], {
  cwd: runtimeRoot,
  env: { ...process.env, CHIEF_PLUGIN_HOST_SMOKE: "1" },
  stdio: "inherit",
});

signDesktopRuntime(
  runtimeRoot,
  process.env.APPLE_SIGNING_IDENTITY?.trim(),
  macEntitlements,
);

const runtimeVersion = (
  await hashFile(join(runtimeRoot, "dist/relay-cell-worker.mjs"))
).slice(0, 16);
writeFileSync(runtimeVersionFile, `${runtimeVersion}\n`);

console.log(`Prepared compact Chief relay cell runtime for ${target}.`);
