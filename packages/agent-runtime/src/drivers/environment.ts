import { isJsonString } from "@chief/relay-contracts";

const RUNTIME_ENVIRONMENT_KEYS = [
  "PATH",
  "HOME",
  "CHIEF_RUNTIME_ROOT",
  "CHIEF_CODEX_BINARY",
  "CHIEF_EXECUTOR_BINARY",
] as const;

/**
 * Workspace credentials can extend an agent's environment, but they cannot
 * replace the process paths the desktop supervisor established. This keeps
 * persisted workspaces from breaking bundled CLIs when a chat is resumed.
 */
export function agentEnvironment(
  overrides?: Record<string, string>,
): Record<string, string> {
  const environment = Object.fromEntries(
    Object.entries({ ...process.env, ...overrides }).filter(
      (entry): entry is [string, string] => isJsonString(entry[1]),
    ),
  );

  for (const key of RUNTIME_ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (value === undefined) delete environment[key];
    else environment[key] = value;
  }

  return environment;
}
