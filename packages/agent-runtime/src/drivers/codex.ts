import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isJsonObject } from "@chief/relay-contracts";

import type { StartOptions } from "../types.js";
import { AcpDriver } from "./acp.js";

export { codexMcpResultText } from "./codex-item-mapper.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

function findCodexAcp() {
  const executable =
    process.platform === "win32" ? "codex-acp.cmd" : "codex-acp";
  const candidates = [
    process.env.CHIEF_CODEX_ACP_BINARY,
    join(moduleDirectory, "..", "node_modules", ".bin", executable),
    join(moduleDirectory, "..", "..", "node_modules", ".bin", executable),
    join(homedir(), ".local", "bin", executable),
    "/opt/homebrew/bin/codex-acp",
    "/usr/local/bin/codex-acp",
  ].filter((value): value is string => Boolean(value));
  return candidates.find(existsSync) ?? executable;
}

function record(value: unknown): Record<string, unknown> {
  return value && isJsonObject(value) && !Array.isArray(value)
    ? (value)
    : {};
}

export function prepareCodexEnvironment(
  options: StartOptions,
  environment: NodeJS.ProcessEnv,
) {
  const storageKey = options.storageKey ?? options.cwd;
  const storageId = createHash("sha256")
    .update(storageKey)
    .digest("hex")
    .slice(0, 32);
  const codexHome = join(homedir(), ".chief", "codex", storageId);
  mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  const userAuth = join(homedir(), ".codex", "auth.json");
  if (existsSync(userAuth)) {
    copyFileSync(userAuth, join(codexHome, "auth.json"));
  }

  let config: Record<string, unknown> = {};
  if (environment.CODEX_CONFIG) {
    try {
      config = record(JSON.parse(environment.CODEX_CONFIG));
    } catch {
      // A malformed ambient override must not prevent a cell from starting.
    }
  }
  const sandbox = record(config.sandbox_workspace_write);
  config.sandbox_workspace_write = { ...sandbox, network_access: true };
  if (options.model) config.model = options.model;

  environment.CODEX_HOME = codexHome;
  environment.CODEX_CONFIG = JSON.stringify(config);
  environment.INITIAL_AGENT_MODE =
    options.access === "full" ? "agent-full-access" : "agent";
  environment.NO_BROWSER = "1";
  environment.APP_SERVER_LOGS = join(codexHome, "logs");

  const packagedBinary = environment.CHIEF_CODEX_BINARY;
  if (process.env.CODEX_PATH) {
    environment.CODEX_PATH = process.env.CODEX_PATH;
  } else if (packagedBinary && existsSync(packagedBinary)) {
    environment.CODEX_PATH = packagedBinary;
  } else {
    delete environment.CODEX_PATH;
  }
}

/**
 * Codex is a first-class desktop harness exposed through ACP. The adapter owns
 * app-server protocol changes, while Chief consumes one provider-neutral
 * stream for messages, thinking, tools, permissions, and resumable sessions.
 */
export class CodexDriver extends AcpDriver {
  constructor() {
    super({
      name: "codex",
      command: findCodexAcp,
      args: [],
      configureEnvironment: prepareCodexEnvironment,
    });
  }
}
