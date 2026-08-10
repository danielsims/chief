import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const KEYCHAIN_SERVICE = "com.danielsims.chief.browser-state";
const KEYCHAIN_ACCOUNT = "default";
const KEY_PATTERN = /^[a-f0-9]{64}$/i;

function validKey(value: string | undefined) {
  const key = value?.trim();
  return key && KEY_PATTERN.test(key) ? key : undefined;
}

function readKeychainKey() {
  try {
    return validKey(
      execFileSync(
        "/usr/bin/security",
        [
          "find-generic-password",
          "-s",
          KEYCHAIN_SERVICE,
          "-a",
          KEYCHAIN_ACCOUNT,
          "-w",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim(),
    );
  } catch {
    return undefined;
  }
}

/**
 * Resolve the host-only key used to encrypt persisted browser authentication.
 * It never enters an agent environment or transcript. macOS stores it in the
 * user's Keychain; other desktop hosts use a private mode-0600 app-data file.
 */
export function browserStateEncryptionKey(
  directory = join(homedir(), ".chief"),
) {
  const configured = validKey(process.env.CHIEF_BROWSER_STATE_ENCRYPTION_KEY);
  if (configured) return configured;

  if (process.platform === "darwin") {
    const stored = readKeychainKey();
    if (stored) return stored;

    const key = randomBytes(32).toString("hex");
    try {
      // Do not use `-U`: concurrent app/runtime starts must not overwrite a
      // key another process just created and make its saved sessions unreadable.
      execFileSync(
        "/usr/bin/security",
        [
          "add-generic-password",
          "-s",
          KEYCHAIN_SERVICE,
          "-a",
          KEYCHAIN_ACCOUNT,
          "-w",
          key,
        ],
        { stdio: "ignore" },
      );
      return key;
    } catch {
      const concurrent = readKeychainKey();
      if (concurrent) return concurrent;
      throw new Error("Chief could not protect browser restore state.");
    }
  }

  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, ".browser-state-key");
  if (existsSync(path)) {
    const key = validKey(readFileSync(path, "utf8"));
    if (key) return key;
  }
  const key = randomBytes(32).toString("hex");
  writeFileSync(path, `${key}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return key;
}
