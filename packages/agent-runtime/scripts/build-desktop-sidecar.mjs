import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");
const tauriRoot = join(repoRoot, "apps/desktop/src-tauri");
const runtimeRoot = join(tauriRoot, "resources/agent-runtime");
const runtimeVersionFile = join(tauriRoot, "resources/agent-runtime.version");
const binariesRoot = join(tauriRoot, "binaries");
const macEntitlements = join(tauriRoot, "Entitlements.plist");

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

function packageManager() {
  if (!process.env.npm_execpath) return ["pnpm"];
  return /\.[cm]?js$/.test(process.env.npm_execpath)
    ? [process.execPath, process.env.npm_execpath]
    : [process.env.npm_execpath];
}

function executablePath(root, name) {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  return join(root, "node_modules", ".bin", `${name}${suffix}`);
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

function regularFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile() && lstatSync(path).isFile()) {
        files.push(path);
      }
    }
  };
  visit(root);
  return files;
}

function signDarwinNativePayloads(root) {
  const identity = process.env.APPLE_SIGNING_IDENTITY?.trim();
  if (process.platform !== "darwin" || !identity) return;

  const nativeFiles = regularFiles(root)
    .map((path) => {
      const description = execFileSync("file", ["-b", path], {
        encoding: "utf8",
      }).trim();
      return { description, path };
    })
    .filter(({ description }) => description.includes("Mach-O"));

  for (const { description, path } of nativeFiles) {
    const args = ["--force", "--sign", identity];
    if (identity !== "-") args.push("--options", "runtime", "--timestamp");
    if (description.includes("executable") && existsSync(macEntitlements)) {
      args.push("--entitlements", macEntitlements);
    }
    args.push(path);
    execFileSync("codesign", args, { stdio: "inherit" });
    execFileSync("codesign", ["--verify", "--strict", path], {
      stdio: "inherit",
    });
  }

  console.log(
    `Signed ${nativeFiles.length} native runtime payloads for notarization.`,
  );
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

const codexPlatformPackage = `codex-${expectedRuntime.platform === "win32" ? "win32" : expectedRuntime.platform}-${expectedRuntime.arch === "arm64" ? "arm64" : "x64"}`;
const codexExecutableName =
  expectedRuntime.platform === "win32" ? "codex.exe" : "codex";

rmSync(runtimeRoot, { recursive: true, force: true });
mkdirSync(dirname(runtimeRoot), { recursive: true });

const [runner, ...runnerArgs] = packageManager();
execFileSync(
  runner,
  [
    ...runnerArgs,
    "--config.node-linker=hoisted",
    "--dir",
    repoRoot,
    "--filter",
    "@chief/agent-runtime",
    "deploy",
    "--prod",
    "--legacy",
    runtimeRoot,
  ],
  { cwd: repoRoot, stdio: "inherit" },
);

mkdirSync(join(runtimeRoot, "dist"), { recursive: true });
await build({
  bundle: true,
  entryPoints: [join(packageRoot, "src/server.ts")],
  format: "esm",
  jsx: "automatic",
  logLevel: "warning",
  outfile: join(runtimeRoot, "dist/server.mjs"),
  packages: "external",
  plugins: [
    {
      name: "bundle-chief-email-renderer",
      setup(build) {
        build.onResolve({ filter: /^@chief\/email\/render$/ }, () => ({
          path: join(repoRoot, "packages/email/src/render.ts"),
        }));
      },
    },
    {
      name: "bundle-google-oauth-connector",
      setup(build) {
        build.onResolve({ filter: /^@chief\/google-oauth-connector$/ }, () => ({
          path: join(repoRoot, "packages/google-oauth-connector/src/index.ts"),
        }));
      },
    },
    {
      name: "bundle-chief-browser",
      setup(build) {
        build.onResolve({ filter: /^@chief\/browser\/node$/ }, () => ({
          path: join(repoRoot, "packages/browser/src/node.ts"),
        }));
      },
    },
  ],
  platform: "node",
  target: "node24",
});

const bundledRuntime = readFileSync(
  join(runtimeRoot, "dist/server.mjs"),
  "utf8",
);
if (
  bundledRuntime.includes('"@chief/google-oauth-connector"') ||
  bundledRuntime.includes("'@chief/google-oauth-connector'")
) {
  throw new Error("Google OAuth connector escaped the desktop runtime bundle.");
}
rmSync(join(runtimeRoot, "node_modules/@chief/google-oauth-connector"), {
  recursive: true,
  force: true,
});
if (
  bundledRuntime.includes('"@chief/browser/node"') ||
  bundledRuntime.includes("'@chief/browser/node'")
) {
  throw new Error("Chief browser client escaped the desktop runtime bundle.");
}
rmSync(join(runtimeRoot, "node_modules/@chief/browser"), {
  recursive: true,
  force: true,
});

// Prompts are runtime assets, not bundled strings. Shipping the canonical
// filesystem tree keeps local Codex, Claude and OpenCode sessions on the same
// definitions that the Eve compiler deploys.
const agentDefinitionsRoot = join(packageRoot, "src/agents");
const bundledAgentDefinitionsRoot = join(runtimeRoot, "agents");
mkdirSync(bundledAgentDefinitionsRoot, { recursive: true });
for (const entry of readdirSync(agentDefinitionsRoot, {
  withFileTypes: true,
})) {
  if (!entry.isDirectory()) continue;
  const instructions = join(
    agentDefinitionsRoot,
    entry.name,
    "instructions.md",
  );
  if (!existsSync(instructions)) continue;
  const targetDirectory = join(bundledAgentDefinitionsRoot, entry.name);
  mkdirSync(targetDirectory, { recursive: true });
  cpSync(instructions, join(targetDirectory, "instructions.md"));
}

// App-managed deployments use a bundled, deterministic Eve workspace. The
// desktop runtime materializes the selected canonical agent into a private
// copy and only deploys after the user presses Deploy in Chief.
const deploymentTemplateSource = join(repoRoot, "apps/workspace");
const deploymentTemplateTarget = join(runtimeRoot, "deployment-workspace");
const deploymentTemplateExcludes = new Set([
  ".cache",
  ".env.local",
  ".eve",
  ".output",
  ".turbo",
  ".vercel",
  "node_modules",
  "workspace-input",
]);
cpSync(deploymentTemplateSource, deploymentTemplateTarget, {
  recursive: true,
  filter: (path) =>
    path === deploymentTemplateSource ||
    !deploymentTemplateExcludes.has(basename(path)),
});

const convexTemplateSource = join(packageRoot, "templates/convex");
const convexTemplateTarget = join(runtimeRoot, "convex-deployment-workspace");
cpSync(convexTemplateSource, convexTemplateTarget, {
  recursive: true,
  filter: (path) =>
    path === convexTemplateSource ||
    !deploymentTemplateExcludes.has(basename(path)),
});

for (const path of [".turbo", "src", "tsconfig.json", "drizzle.config.ts"]) {
  rmSync(join(runtimeRoot, path), { recursive: true, force: true });
}

const nativeCodexRoot = join(
  runtimeRoot,
  "node_modules",
  "@openai",
  codexPlatformPackage,
  "vendor",
  target,
);
const nativeCodex = join(nativeCodexRoot, "bin", codexExecutableName);
if (!existsSync(nativeCodex)) {
  throw new Error(`Target-native Codex binary is missing: ${nativeCodex}`);
}
const bundledCodexRoot = join(runtimeRoot, "codex");
cpSync(nativeCodexRoot, bundledCodexRoot, { recursive: true });
const bundledCodex = join(bundledCodexRoot, "bin", codexExecutableName);
chmodSync(bundledCodex, 0o755);
execFileSync(bundledCodex, ["--version"], { stdio: "inherit" });
rmSync(join(runtimeRoot, "node_modules", ".bin", "codex"), { force: true });
rmSync(join(runtimeRoot, "node_modules", "@openai", "codex"), {
  recursive: true,
  force: true,
});
rmSync(join(runtimeRoot, "node_modules", "@openai", codexPlatformPackage), {
  recursive: true,
  force: true,
});

mkdirSync(binariesRoot, { recursive: true });
const sidecarName = `chief-agent-runtime-${target}${process.platform === "win32" ? ".exe" : ""}`;
const sidecarPath = join(binariesRoot, sidecarName);
copyFileSync(nodeBinary, sidecarPath);
chmodSync(sidecarPath, 0o755);

for (const name of ["convex", "executor"]) {
  const path = executablePath(runtimeRoot, name);
  if (!existsSync(path)) {
    throw new Error(`Required bundled agent binary is missing: ${path}`);
  }
}

for (const cli of [
  join(runtimeRoot, "node_modules", "convex", "bin", "main.js"),
  join(runtimeRoot, "node_modules", "eve", "bin", "eve.js"),
  join(runtimeRoot, "node_modules", "pnpm", "bin", "pnpm.cjs"),
  join(runtimeRoot, "node_modules", "vercel", "dist", "vc.js"),
]) {
  if (!existsSync(cli))
    throw new Error(`Required deployment CLI is missing: ${cli}`);
  execFileSync(nodeBinary, [cli, "--version"], { stdio: "inherit" });
}

for (const dependency of [
  "react",
  "@react-email/components",
  "@react-email/render",
]) {
  const manifest = join(
    runtimeRoot,
    "node_modules",
    dependency,
    "package.json",
  );
  if (!existsSync(manifest)) {
    throw new Error(
      `Required bundled runtime dependency is missing: ${dependency}`,
    );
  }
}

signDarwinNativePayloads(runtimeRoot);

const runtimeVersion = (
  await hashFile(join(runtimeRoot, "dist/server.mjs"))
).slice(0, 16);
writeFileSync(runtimeVersionFile, `${runtimeVersion}\n`);

console.log(`Prepared Chief runtime sidecar for ${target}.`);
