import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const tauri = resolve(dirname(fileURLToPath(import.meta.url)), "../src-tauri");

// Local client builds reuse a published runtime rather than generating a digest
// for an archive that has never been uploaded. Offline builds remain separate.
/**
 * @param {{ tag_name?: string, draft?: boolean, assets?: Array<{ name?: string, state?: string, digest?: string, browser_download_url?: string }> }} metadata
 * @param {string} version
 * @param {string} target
 */
export function publishedRuntimeRelease(metadata, version, target) {
  const tag = `v${version}`;
  const name = `chief-plugin-runtime-${version}-${target}.tar.gz`;
  const url = `https://github.com/danielsims/chief/releases/download/${tag}/${name}`;
  const asset = metadata.assets?.find((item) => item.name === name);
  const digest = asset?.digest ?? "";
  if (
    metadata.tag_name !== tag ||
    metadata.draft ||
    !asset ||
    asset.state !== "uploaded" ||
    asset.browser_download_url !== url ||
    !/^sha256:[a-f0-9]{64}$/.test(digest)
  ) {
    throw new Error(
      `No published, SHA-256-pinned runtime for ${tag} (${target}). Use the explicit offline build for an unpublished runtime.`,
    );
  }
  return { url, sha256: digest.slice("sha256:".length) };
}

export async function pinPublishedRuntime() {
  const { version } = JSON.parse(
    readFileSync(join(tauri, "tauri.conf.json"), "utf8"),
  );
  const target =
    process.env.TAURI_ENV_TARGET_TRIPLE ??
    execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(
      /^host: (.+)$/m,
    )?.[1];
  if (!target || !/^[a-z0-9_-]+$/.test(target))
    throw new Error("Invalid runtime target.");
  const response = await fetch(
    `https://api.github.com/repos/danielsims/chief/releases/tags/v${version}`,
    {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Could not resolve the published runtime (${response.status}).`,
    );
  const release = publishedRuntimeRelease(
    await response.json(),
    version,
    target,
  );
  writeFileSync(
    join(tauri, "plugin-runtime-release.json"),
    `${JSON.stringify({ [target]: release }, null, 2)}\n`,
  );
  console.log(
    `Pinned published runtime for v${version} (${target}); runtime stays outside the DMG.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await pinPublishedRuntime();
}
