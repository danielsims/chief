import type { DriverType } from "../types.js";
import { BaseDriver } from "./base.js";
import { ClaudeDriver } from "./claude.js";
import { CodexDriver } from "./codex.js";
import { OpenCodeDriver } from "./opencode.js";
import { RemoteDriver } from "./remote.js";

/**
 * Driver registry — the seam between the transport-agnostic session layer
 * and per-backend protocol adapters (mobile-agent pattern). Adding a backend
 * means one adapter file + one registry entry; nothing else changes.
 *
 */
const registry: Record<DriverType, new () => BaseDriver> = {
  claude: ClaudeDriver,
  codex: CodexDriver,
  opencode: OpenCodeDriver,
  remote: RemoteDriver,
};

export function createDriver(type: DriverType): BaseDriver {
  const Driver = registry[type];
  return new Driver();
}

export { BaseDriver, ClaudeDriver, CodexDriver, OpenCodeDriver, RemoteDriver };
