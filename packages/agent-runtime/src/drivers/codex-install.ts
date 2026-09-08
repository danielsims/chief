import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { chmod, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { extract } from "tar";

import { CODEX_VERSION, codexDistributions } from "./codex-distributions.js";

const run = promisify(execFile);
let preparing: Promise<string> | undefined;
let setup: Promise<{ binary: string; adapter: string }> | undefined;

function reportSetup(
  state: "downloading" | "ready" | "error",
  label: string,
  percent?: number,
) {
  const root = process.env.CHIEF_CELL_ROOT;
  if (!root) return;
  const path = join(root, "runtime-setup.json");
  try {
    const temporary = `${path}.${process.pid}`;
    writeFileSync(
      temporary,
      JSON.stringify({ state, label, percent, updatedAt: Date.now() }),
      { mode: 0o600 },
    );
    renameSync(temporary, path);
  } catch (error) {
    console.error("[codex] Could not publish setup progress:", error);
  }
}

export function ensureCodexSetup() {
  setup ??= (async () => {
    try {
      const adapter = await ensureCodexAdapter();
      const binary = await ensureCodexBinary();
      reportSetup("ready", "Codex is ready");
      return { adapter, binary };
    } catch (error) {
      setup = undefined;
      reportSetup("error", "Codex setup failed. Retrying shortly.");
      throw error;
    }
  })();
  return setup;
}

async function ensureCodexAdapter() {
  if (process.env.CHIEF_CODEX_ACP_BINARY)
    return process.env.CHIEF_CODEX_ACP_BINARY;
  try {
    return createRequire(import.meta.url).resolve(
      "@agentclientprotocol/codex-acp",
    );
  } catch {
    /* Not included in the desktop download. */
  }
  const root = join(homedir(), ".chief", "runtimes", "codex-acp");
  const destination = join(root, "1.6.2");
  const entry = join(destination, "dist", "index.js");
  if (existsSync(entry)) return entry;
  await mkdir(root, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(root, "download-"));
  try {
    const archive = join(staging, "adapter.tgz");
    reportSetup("downloading", "Downloading the Codex adapter", 0);
    await downloadVerified(
      "https://registry.npmjs.org/@agentclientprotocol/codex-acp/-/codex-acp-1.6.2.tgz",
      "sha512-2eF1mbs1gTqkZJSLYOun/pFDx37sYa7W63HOPezC37b/R8AYms5O1nfQu8lrqFSGDrwDZkASVORymLcqjCNqyA==",
      archive,
      (percent) =>
        reportSetup("downloading", "Downloading the Codex adapter", percent),
    );
    const payload = join(staging, "payload");
    await mkdir(payload, { mode: 0o700 });
    await extract({
      file: archive,
      cwd: payload,
      strip: 1,
      strict: true,
      filter: (path, item) =>
        [
          "package/dist/index.js",
          "package/package.json",
          "package/LICENSE",
        ].includes(path) &&
        "type" in item &&
        item.type === "File",
    });
    if (!existsSync(join(payload, "dist/index.js")))
      throw new Error("The Codex adapter package is incomplete.");
    try {
      await rename(payload, destination);
    } catch (error) {
      if (!existsSync(entry)) throw error;
    }
    return entry;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** Called when a Codex cell starts, and again before a turn if setup failed. */
export function ensureCodexBinary(): Promise<string> {
  preparing ??= resolveCodexBinary().catch((error: unknown) => {
    preparing = undefined;
    throw error;
  });
  return preparing;
}

async function resolveCodexBinary() {
  const override = process.env.CODEX_PATH;
  if (override) return override;
  const packaged = process.env.CHIEF_CODEX_BINARY;
  if (packaged && existsSync(packaged)) return packaged;
  const target = `${process.platform}-${process.arch}`;
  const distribution = codexDistributions[target];
  if (!distribution) throw new Error(`Codex is not available for ${target}.`);
  const executable = process.platform === "win32" ? "codex.exe" : "codex";
  try {
    const require = createRequire(import.meta.url);
    const codexRequire = createRequire(
      require.resolve("@openai/codex/package.json"),
    );
    const nativeManifest = codexRequire.resolve(
      `@openai/codex-${target}/package.json`,
    );
    const native = join(
      nativeManifest,
      "..",
      "vendor",
      distribution.triple,
      "bin",
      executable,
    );
    if (existsSync(native)) return native;
  } catch {
    // Native Codex is installed on demand in packaged Chief.
  }
  const root = join(homedir(), ".chief", "runtimes", "codex", CODEX_VERSION);
  const destination = join(root, target);
  const binary = join(destination, "bin", executable);
  if (existsSync(binary)) return binary;
  await mkdir(root, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(root, `${target}-download-`));
  try {
    console.info(`[codex] Installing Codex ${CODEX_VERSION} for ${target}.`);
    const archive = join(staging, "runtime.tgz");
    reportSetup("downloading", "Downloading Codex", 0);
    await downloadVerified(
      distribution.url,
      distribution.integrity,
      archive,
      (percent) => reportSetup("downloading", "Downloading Codex", percent),
    );
    const payload = join(staging, "payload");
    await mkdir(payload, { mode: 0o700 });
    await extract({
      file: archive,
      cwd: payload,
      strip: 3,
      strict: true,
      filter: (path, entry) =>
        path.startsWith(`package/vendor/${distribution.triple}/`) &&
        "type" in entry &&
        (entry.type === "File" || entry.type === "Directory"),
    });
    const prepared = join(payload, "bin", executable);
    await chmod(prepared, 0o755);
    await run(prepared, ["--version"], { timeout: 30_000 });
    try {
      await rename(payload, destination);
    } catch (error) {
      // Another cell may have completed the same verified installation first.
      if (!existsSync(binary)) throw error;
    }
    console.info(`[codex] Codex ${CODEX_VERSION} is ready.`);
    return binary;
  } catch (error) {
    throw new Error(
      "Chief couldn't finish installing Codex. Check your connection and try again.",
      { cause: error },
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function downloadVerified(
  url: string,
  integrity: string,
  destination: string,
  onProgress?: (percent: number | undefined) => void,
) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(180_000),
    redirect: "error",
  });
  if (!response.ok || !response.body)
    throw new Error(`Codex download failed (${response.status}).`);
  const hash = createHash("sha512");
  let bytes = 0;
  const total = Number(response.headers.get("content-length"));
  let lastProgressAt = 0;
  const reader = response.body.getReader();
  async function* chunks() {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      await reader.cancel();
    }
  }
  await pipeline(
    chunks(),
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > 512 * 1024 * 1024)
          return callback(new Error("Codex download exceeded its size limit."));
        hash.update(chunk);
        if (Date.now() - lastProgressAt >= 250) {
          lastProgressAt = Date.now();
          onProgress?.(
            total > 0
              ? Math.min(99, Math.round((bytes / total) * 100))
              : undefined,
          );
        }
        callback(null, chunk);
      },
    }),
    createWriteStream(destination, { mode: 0o600, flags: "wx" }),
  );
  if (`sha512-${hash.digest("base64")}` !== integrity) {
    throw new Error("Codex download did not match its published checksum.");
  }
}
