import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { verificationRuntime } from "./verification-runtime.mjs";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appBundle = resolve(
  process.env.CHIEF_APP_BUNDLE_PATH ??
    join(desktopRoot, "src-tauri/target/release/bundle/macos/Chief.app"),
);
const runtime = await verificationRuntime(
  appBundle,
  join(desktopRoot, "src-tauri"),
);
const runtimeRoot = runtime.root;
const executable = runtime.executable;
const worker = join(runtimeRoot, "dist/plugin-host-worker.mjs");
const cellWorker = join(runtimeRoot, "dist/relay-cell-worker.mjs");

if (!existsSync(executable) || !existsSync(worker) || !existsSync(cellWorker)) {
  runtime.cleanup();
  throw new Error("The packaged Chief runtime is missing.");
}

// Test actual native imports after final signing, with an isolated database and
// no relay connection or account credentials. The plugin host alone misses this.
const cellRoot = mkdtempSync(join(tmpdir(), "chief-packaged-cell-"));
try {
  execFileSync(executable, [cellWorker, "smoke"], {
    cwd: runtimeRoot,
    env: { ...process.env, CHIEF_CELL_ROOT: cellRoot },
    stdio: "inherit",
    timeout: 30_000,
  });
  console.log("Signed agent worker loaded its native database successfully.");
} catch (error) {
  runtime.cleanup();
  throw error;
} finally {
  rmSync(cellRoot, { recursive: true, force: true });
}

const port = await availablePort();
const token = randomBytes(32).toString("hex");
const child = spawn(executable, [worker], {
  cwd: runtimeRoot,
  env: {
    ...process.env,
    CHIEF_PLUGIN_HOST_PORT: String(port),
    CHIEF_PLUGIN_HOST_TOKEN: token,
    CHIEF_PLUGIN_ROOT: join(desktopRoot, ".plugin-host-smoke"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

try {
  await waitForHealth({ child, output: () => output, port, token });
  console.log("Packaged Chief plugin host passed its signed runtime check.");
} finally {
  await stopChild(child);
  runtime.cleanup();
}

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address()?.port;
      if (!Number.isInteger(port)) {
        server.close();
        reject(new Error("Could not reserve a plugin-host test port."));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolvePort(port);
      });
    });
  });
}

async function waitForHealth({ child, output, port, token }) {
  // A freshly mounted, signed app may be held briefly by macOS verification
  // before its executable starts. Give the disk-image copy the same realistic
  // startup window as the desktop application.
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(
        `The packaged plugin host exited with code ${child.exitCode}.\n${output()}`,
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) return;
    } catch {
      // The process has not bound its loopback port yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(
    `The packaged plugin host did not become ready.\n${output()}`,
  );
}

async function stopChild(child) {
  if (childHasStopped(child)) return;
  const gracefulExit = waitForChildExit(child, 2_000);
  child.kill("SIGTERM");
  if (await gracefulExit) return;

  const forcedExit = waitForChildExit(child, 2_000);
  child.kill("SIGKILL");
  if (!(await forcedExit)) {
    throw new Error("The packaged plugin host did not stop cleanly.");
  }
}

function childHasStopped(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForChildExit(child, timeoutMs) {
  if (childHasStopped(child)) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    const finish = (exited) => {
      clearTimeout(timer);
      child.off("exit", onExit);
      resolveExit(exited || childHasStopped(child));
    };
    child.once("exit", onExit);
    if (childHasStopped(child)) finish(true);
  });
}
