import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/** Resolve the same digest-pinned runtime the lightweight app will install. */
export async function verificationRuntime(appBundle, tauri) {
  const contents = join(appBundle, "Contents");
  const bundledRoot = join(contents, "Resources/agent-runtime");
  const bundledExecutable = join(contents, "MacOS/chief-agent-runtime");
  if (
    existsSync(join(bundledRoot, "dist/relay-cell-worker.mjs")) &&
    existsSync(bundledExecutable)
  ) {
    return {
      root: bundledRoot,
      executable: bundledExecutable,
      cleanup: () => {},
    };
  }
  const target = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(
    /^host: (.+)$/m,
  )?.[1];
  const releases = JSON.parse(
    readFileSync(join(tauri, "plugin-runtime-release.json"), "utf8"),
  );
  const release = releases[target];
  const { version, identifier } = JSON.parse(
    readFileSync(join(tauri, "tauri.conf.json"), "utf8"),
  );
  const expectedUrl = `https://github.com/danielsims/chief/releases/download/v${version}/chief-plugin-runtime-${version}-${target}.tar.gz`;
  if (
    !release ||
    release.url !== expectedUrl ||
    !/^[a-f0-9]{64}$/.test(release.sha256)
  ) {
    throw new Error("Lightweight build has no valid published runtime pin.");
  }
  const cached = join(
    homedir(),
    "Library/Application Support",
    identifier,
    "plugin-runtimes",
    release.sha256,
  );
  if (
    existsSync(join(cached, ".verified")) &&
    readFileSync(join(cached, ".verified"), "utf8") === release.sha256
  ) {
    return {
      root: join(cached, "agent-runtime"),
      executable: join(cached, "chief-agent-runtime"),
      cleanup: () => {},
    };
  }
  const temporary = mkdtempSync(join(tmpdir(), "chief-runtime-verify-"));
  const cleanup = () => rmSync(temporary, { recursive: true, force: true });
  try {
    const response = await fetch(release.url, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok)
      throw new Error(`Runtime download failed (${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== release.sha256)
      throw new Error("Runtime download failed SHA-256 verification.");
    const archive = join(temporary, "runtime.tar.gz");
    writeFileSync(archive, bytes);
    const names = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
      .trim()
      .split("\n");
    if (
      names.some(
        (name) => name.startsWith("/") || name.split("/").includes(".."),
      )
    )
      throw new Error("Unsafe runtime archive path.");
    const entries = execFileSync("tar", ["-tvzf", archive], {
      encoding: "utf8",
    })
      .trim()
      .split("\n");
    if (entries.some((entry) => !["d", "-"].includes(entry[0])))
      throw new Error(
        "Runtime archive contains unsupported links or special files.",
      );
    execFileSync("tar", ["-xzf", archive, "-C", temporary]);
    return {
      root: join(temporary, "agent-runtime"),
      executable: join(temporary, "chief-agent-runtime"),
      cleanup,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
