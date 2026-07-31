import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

import {
  chiefBuzzAppManifest,
  chiefMarketingTeamSnapshot,
} from "../src/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactsDirectory = resolve(packageRoot, "artifacts");

const serialize = async (value: unknown) =>
  format(JSON.stringify(value), {
    parser: "json",
  });

await mkdir(artifactsDirectory, { recursive: true });
await Promise.all([
  writeFile(
    resolve(artifactsDirectory, "chief.app.json"),
    await serialize(chiefBuzzAppManifest),
  ),
  writeFile(
    resolve(artifactsDirectory, "chief.team.json"),
    await serialize(chiefMarketingTeamSnapshot),
  ),
]);
