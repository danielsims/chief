// Confirms every pinned plugin runtime can be downloaded anonymously and matches
// its digest. A lightweight build whose runtime is missing (for example, still in
// a draft release) cannot set up local plugins, so it must not ship.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releases = JSON.parse(
  readFileSync(join(desktop, "src-tauri/plugin-runtime-release.json"), "utf8"),
);

const failures = [];
for (const [target, { url, sha256 }] of Object.entries(releases)) {
  try {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      failures.push(
        `${target}: HTTP ${response.status}. Publish the release that holds ${url}.`,
      );
      continue;
    }
    const digest = createHash("sha256")
      .update(Buffer.from(await response.arrayBuffer()))
      .digest("hex");
    if (digest !== sha256) {
      failures.push(`${target}: digest ${digest} does not match ${sha256}.`);
      continue;
    }
    console.log(`${target}: plugin runtime is published and verified.`);
  } catch (error) {
    failures.push(
      `${target}: ${error instanceof Error ? error.message : error}`,
    );
  }
}

if (failures.length > 0) {
  console.error(
    `Plugin runtime release check failed:\n${failures.map((line) => `  ${line}`).join("\n")}`,
  );
  process.exit(1);
}
