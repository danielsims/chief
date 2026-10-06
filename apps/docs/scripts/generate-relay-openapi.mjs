import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";

import { createRelayOpenApiDocument } from "@chief/relay-contracts/openapi";

const outputPath = fileURLToPath(
  new URL("../generated/relay-openapi.json", import.meta.url),
);

const document = createRelayOpenApiDocument("https://relay.heychief.sh");

await mkdir(dirname(outputPath), { recursive: true });
const prettierConfig = await resolveConfig(outputPath);
const source = await format(JSON.stringify(document), {
  ...prettierConfig,
  filepath: outputPath,
  parser: "json",
});
await writeFile(outputPath, source, "utf8");
