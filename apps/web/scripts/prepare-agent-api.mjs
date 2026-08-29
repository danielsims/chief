import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import process from "node:process";

const runtimeManifest = new URL(
  "../../../packages/agent-runtime/package.json",
  import.meta.url,
);
const generatedApi = new URL(
  "../generated/local-tools-openapi.json",
  import.meta.url,
);

const exists = async (url) => {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
};

if (await exists(runtimeManifest)) {
  const child = spawn("pnpm", ["generate:agent-api"], {
    cwd: new URL("..", import.meta.url),
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });

  if (exitCode !== 0) process.exit(exitCode ?? 1);
} else if (!(await exists(generatedApi))) {
  throw new Error(
    "The generated agent API reference is missing from this deployment.",
  );
}
