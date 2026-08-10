import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const maximumLines = 500;
// Existing composition debt is explicit and may only shrink. New files and
// refactored files must stay under the normal limit; growing a listed file
// fails lint just as growing past 500 does.
const legacyLineLimits = new Map([
  ["apps/desktop/src/pages/onboarding.tsx", 3879],
  ["apps/desktop/src/pages/schedule.tsx", 2247],
  ["apps/desktop/src/lib/runtime.tsx", 2531],
  ["packages/agent-runtime/src/server.ts", 3669],
  ["apps/desktop/src/pages/dashboard.tsx", 1485],
  ["packages/agent-runtime/src/local-store.ts", 2880],
  ["packages/agent-runtime/src/scheduler.ts", 1247],
  ["packages/backend/convex/billing.ts", 987],
  ["apps/desktop/src/pages/agents.tsx", 976],
  ["packages/agent-runtime/src/drivers/codex.ts", 1043],
  ["packages/agent-runtime/src/local-tools.ts", 1860],
  ["packages/backend/convex/googleAnalytics.ts", 886],
  ["apps/desktop/src/pages/analytics.tsx", 846],
  ["packages/agent-runtime/src/types.ts", 1204],
  ["apps/desktop/src/lib/playbooks.ts", 846],
  ["apps/desktop/src/pages/results.tsx", 759],
  ["apps/desktop/src-tauri/src/lib.rs", 777],
  ["packages/backend/convex/agentTools.ts", 1465],
  ["packages/agent-runtime/src/drivers/opencode.ts", 576],
  ["packages/backend/convex/auth.ts", 569],
  ["packages/agent-runtime/src/manager.ts", 1175],
  ["apps/desktop/src/components/chat/agent-chat.tsx", 534],
  ["packages/email/src/templates/digest/chief-digest-email.tsx", 539],
  ["packages/agent-runtime/src/tools/control-plane.ts", 1167],
  ["packages/agent-runtime/src/drivers/remote-eve.ts", 512],
  ["packages/agent-runtime/test/local-store.test.ts", 754],
  ["packages/agent-runtime/test/manager.test.ts", 815],
  ["apps/desktop/src/components/agents/agent-deployment-panel.tsx", 676],
]);
const sourceExtensions = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".rs",
  ".ts",
  ".tsx",
]);
const ignoredDirectories = new Set([
  ".cache",
  ".eve",
  ".git",
  ".next",
  ".output",
  ".turbo",
  "_generated",
  "binaries",
  "coverage",
  "dist",
  "node_modules",
  "resources",
  "target",
]);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && sourceExtensions.has(extname(entry.name))
      ? [path]
      : [];
  });
}

const failures = sourceFiles(root).flatMap((path) => {
  const source = readFileSync(path, "utf8");
  const lines =
    source.length === 0
      ? 0
      : source.split(/\r?\n/u).length - (source.endsWith("\n") ? 1 : 0);
  const relativePath = relative(root, path);
  const limit = legacyLineLimits.get(relativePath) ?? maximumLines;
  return lines > limit ? [{ lines, limit, path: relativePath }] : [];
});

if (failures.length > 0) {
  failures.sort((a, b) => b.lines - a.lines);
  console.error(
    `Source files may not exceed ${maximumLines} lines or their recorded legacy limit:`,
  );
  for (const failure of failures) {
    console.error(`  ${failure.lines}/${failure.limit}  ${failure.path}`);
  }
  process.exitCode = 1;
}
