import { BaseDriver } from "./base.js";
import { ClaudeDriver } from "./claude.js";
import { CodexDriver } from "./codex.js";
import { OpenCodeDriver } from "./opencode.js";
import type { DriverType } from "../types.js";

/**
 * Driver registry — the seam between the transport-agnostic session layer
 * and per-backend protocol adapters (mobile-agent pattern). Adding a backend
 * means one adapter file + one registry entry; nothing else changes.
 *
 * Future adapters: "opencode" (`opencode acp`, stdio JSON-RPC — see
 * ~/Documents/claude/mobile-agent/service/src/drivers/OpenCodeDriver.js),
 * "vercel" (deployed eve-style agent over HTTP).
 */
const registry: Record<DriverType, new () => BaseDriver> = {
  claude: ClaudeDriver,
  codex: CodexDriver,
  opencode: OpenCodeDriver,
};

export function createDriver(type: DriverType): BaseDriver {
  const Driver = registry[type];
  if (!Driver) throw new Error(`unknown driver type: ${type}`);
  return new Driver();
}

export { BaseDriver, ClaudeDriver, CodexDriver, OpenCodeDriver };
