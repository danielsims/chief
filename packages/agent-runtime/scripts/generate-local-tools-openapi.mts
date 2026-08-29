import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { format, resolveConfig } from "prettier";

import { localToolsOpenApi } from "../src/local-tools-openapi.js";

const outputArgument = process.argv[2];
if (!outputArgument) {
  throw new Error("An OpenAPI output path is required.");
}

const outputPath = resolve(outputArgument);
const document = localToolsOpenApi("http://127.0.0.1:4318");

await mkdir(dirname(outputPath), { recursive: true });
const prettierConfig = await resolveConfig(outputPath);
const source = await format(JSON.stringify(document), {
  ...prettierConfig,
  filepath: outputPath,
  parser: "json",
});
await writeFile(outputPath, source, "utf8");
