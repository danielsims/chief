import type { DriverType } from "../types.js";

export function parseDriverType(value: string): DriverType {
  if (
    value === "claude" ||
    value === "codex" ||
    value === "opencode" ||
    value === "remote"
  ) {
    return value;
  }
  throw new Error(`Unsupported agent app: ${value}`);
}
