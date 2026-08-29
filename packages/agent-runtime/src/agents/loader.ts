import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Filesystem root for authored agent definitions (skills live on disk). */
export function agentDefinitionsRoot(): string {
  const bundledOrSourceRoot = fileURLToPath(
    new URL("../agents/", import.meta.url),
  );
  const candidates = [
    process.env.CHIEF_AGENT_DEFINITIONS_DIR,
    bundledOrSourceRoot,
    join(process.cwd(), "packages/agent-runtime/src/agents"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const root = candidates.find((candidate) =>
    existsSync(join(candidate, "chief", "instructions.md")),
  );
  if (!root) {
    throw new Error(
      `Chief agent definitions were not found. Checked: ${candidates.join(", ")}`,
    );
  }
  return root;
}
