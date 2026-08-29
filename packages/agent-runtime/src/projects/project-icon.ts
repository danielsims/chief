import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";

import { isJsonString } from "@chief/relay-contracts";

const MAX_ICON_BYTES = 512 * 1024;
const MAX_SCAN_DEPTH = 4;
const MAX_SCANNED_ENTRIES = 2_000;
const MAX_ICON_CACHE_ENTRIES = 256;
const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);
const supportedTypes: Record<string, string> = {
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const iconCache = new Map<string, Promise<string | undefined>>();

function scoreIcon(path: string) {
  const normalized = path.split(sep).join("/").toLowerCase();
  const name = normalized.split("/").at(-1) ?? "";
  const depth = normalized.split("/").length - 1;
  let score = depth * 12;
  if (normalized === "app/icon.png") score -= 100;
  else if (normalized === "app/favicon.ico") score -= 96;
  else if (normalized === "src/app/icon.png") score -= 92;
  else if (normalized === "src/app/favicon.ico") score -= 88;
  else if (normalized === "public/favicon.ico") score -= 84;
  else if (normalized === "public/favicon.png") score -= 80;
  else if (normalized === "favicon.ico") score -= 76;
  else if (normalized === "favicon.png") score -= 72;
  else if (name.startsWith("favicon")) score -= 50;
  else if (name.startsWith("apple-touch-icon")) score -= 42;
  else if (name.startsWith("icon")) score -= 34;
  if (normalized.includes("/public/")) score -= 8;
  return score;
}

async function scanProjectIcon(repositoryPath: string) {
  const candidates: string[] = [];
  const queue = [{ path: repositoryPath, depth: 0 }];
  let scanned = 0;
  while (queue.length > 0 && scanned < MAX_SCANNED_ENTRIES) {
    const current = queue.shift();
    if (!current) break;
    let entries;
    try {
      entries = await readdir(current.path, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      scanned += 1;
      if (scanned > MAX_SCANNED_ENTRIES) break;
      if (entry.isSymbolicLink()) continue;
      const absolutePath = join(current.path, entry.name);
      if (entry.isDirectory()) {
        if (
          current.depth < MAX_SCAN_DEPTH &&
          !ignoredDirectories.has(entry.name)
        ) {
          queue.push({ path: absolutePath, depth: current.depth + 1 });
        }
        continue;
      }
      const extension = extname(entry.name).toLowerCase();
      if (!supportedTypes[extension]) continue;
      const lowerName = entry.name.toLowerCase();
      if (
        lowerName.startsWith("favicon") ||
        lowerName.startsWith("icon") ||
        lowerName.startsWith("apple-touch-icon")
      ) {
        candidates.push(absolutePath);
      }
    }
  }
  candidates.sort(
    (left, right) =>
      scoreIcon(relative(repositoryPath, left)) -
      scoreIcon(relative(repositoryPath, right)),
  );
  for (const candidate of candidates) {
    const extension = extname(candidate).toLowerCase();
    const mimeType = supportedTypes[extension];
    if (!mimeType) continue;
    try {
      const metadata = await stat(candidate);
      if (!metadata.isFile() || metadata.size > MAX_ICON_BYTES) continue;
      const content = await readFile(candidate);
      return `data:${mimeType};base64,${content.toString("base64")}`;
    } catch {
      // A candidate may disappear while a project is rebuilding.
    }
  }
  return undefined;
}

/** Finds a safe raster app icon without exposing arbitrary local file paths. */
export function projectIconDataUrl(repositoryPath: string, revision?: string) {
  const key = `${repositoryPath}\0${revision ?? ""}`;
  let cached = iconCache.get(key);
  if (!cached) {
    cached = scanProjectIcon(repositoryPath);
    iconCache.set(key, cached);
    if (iconCache.size > MAX_ICON_CACHE_ENTRIES) {
      const oldest = iconCache.keys().next().value;
      if (isJsonString(oldest)) iconCache.delete(oldest);
    }
  }
  return cached;
}
