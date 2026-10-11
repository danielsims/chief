import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The person's own Claude Code install, so agents run the version they keep
 * updated (and its models) rather than the copy bundled with the SDK. Falls
 * back to the bundled copy when none is installed.
 */
export function findClaudeCode() {
  return [
    join(homedir(), ".local", "bin", "claude"),
    join(homedir(), ".claude", "local", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ].find(existsSync);
}
