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
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { create as createTar } from "tar";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");
const tauriRoot = join(repoRoot, "apps/desktop/src-tauri");
const runtimeRoot = join(tauriRoot, "resources/agent-runtime");
const runtimeArchive = join(tauriRoot, "resources/agent-runtime.tar.gz");
const runtimeVersionFile = join(tauriRoot, "resources/agent-runtime.version");
const binariesRoot = join(tauriRoot, "binaries");
const macEntitlements = join(tauriRoot, "Entitlements.plist");

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
    const args = [
      "--force",
      "--sign",
      identity,
      "--options",
      "runtime",
      "--timestamp",
    ];
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

rmSync(runtimeRoot, { recursive: true, force: true });
mkdirSync(dirname(runtimeRoot), { recursive: true });

const [runner, ...runnerArgs] = packageManager();
execFileSync(
  runner,
  [
    ...runnerArgs,
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
  ],
  platform: "node",
  target: "node24",
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
    !deploymentTemplateExcludes.has(path.split("/").at(-1)),
});

for (const path of [".turbo", "src", "tsconfig.json", "drizzle.config.ts"]) {
  rmSync(join(runtimeRoot, path), { recursive: true, force: true });
}

mkdirSync(binariesRoot, { recursive: true });
const sidecarName = `chief-agent-runtime-${target}${process.platform === "win32" ? ".exe" : ""}`;
const sidecarPath = join(binariesRoot, sidecarName);
copyFileSync(nodeBinary, sidecarPath);
chmodSync(sidecarPath, 0o755);

for (const name of ["codex", "executor"]) {
  const path = executablePath(runtimeRoot, name);
  if (!existsSync(path)) {
    throw new Error(`Required bundled agent binary is missing: ${path}`);
  }
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

rmSync(runtimeArchive, { force: true });
createTar(
  {
    cwd: runtimeRoot,
    file: runtimeArchive,
    gzip: true,
    portable: true,
    sync: true,
  },
  ["."],
);
const runtimeVersion = (await hashFile(runtimeArchive)).slice(0, 16);
writeFileSync(runtimeVersionFile, `${runtimeVersion}\n`);
rmSync(runtimeRoot, { recursive: true, force: true });

console.log(`Prepared Chief runtime sidecar for ${target}.`);
