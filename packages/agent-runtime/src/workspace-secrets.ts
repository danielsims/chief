import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const KEYCHAIN_SERVICE = "com.latentsupply.marketer.workspace-secrets";
const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;

interface SecretIndex {
  env: string[];
  files: string[];
}

export function workspaceKey(workspaceId: string): string {
  return createHash("sha256").update(workspaceId).digest("hex").slice(0, 24);
}

export function workspaceRoot(workspaceId: string): string {
  return join(homedir(), ".marketer", "workspaces", workspaceKey(workspaceId));
}

function ensurePrivateDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function indexPath(workspaceId: string) {
  return join(workspaceRoot(workspaceId), "secret-index.json");
}

function readIndex(workspaceId: string): SecretIndex {
  try {
    const parsed = JSON.parse(readFileSync(indexPath(workspaceId), "utf8")) as
      Partial<SecretIndex> | undefined;
    return {
      env: Array.isArray(parsed?.env) ? parsed.env : [],
      files: Array.isArray(parsed?.files) ? parsed.files : [],
    };
  } catch {
    return { env: [], files: [] };
  }
}

function writeIndex(workspaceId: string, index: SecretIndex) {
  const root = workspaceRoot(workspaceId);
  ensurePrivateDirectory(root);
  const target = indexPath(workspaceId);
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(index, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, target);
  chmodSync(target, 0o600);
}

function account(workspaceId: string, kind: "env" | "file", name: string) {
  return `${workspaceKey(workspaceId)}:${kind}:${name}`;
}

async function keychainRead(accountName: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-a",
        accountName,
        "-s",
        KEYCHAIN_SERVICE,
        "-w",
      ],
      { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
    );
    return stdout.replace(/\n$/, "");
  } catch {
    return null;
  }
}

async function keychainWrite(accountName: string, value: string) {
  // `security` is the native Keychain interface available to the Node side of
  // the desktop runtime. execFile avoids a shell and never logs the arguments.
  await execFileAsync(
    "/usr/bin/security",
    [
      "add-generic-password",
      "-U",
      "-a",
      accountName,
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
      value,
    ],
    { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
  );
}

function shellValue(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function safeFileName(path: string) {
  const name = basename(path).replace(/[^A-Za-z0-9._-]/g, "_");
  if (!name || name === "." || name === "..") {
    throw new Error("Invalid secret file name.");
  }
  return name;
}

/**
 * Durable secrets live in macOS Keychain under an account derived from the
 * authenticated Better Auth organization id. Only a short-lived, mode-0600
 * environment file is materialized while that workspace has a live agent.
 */
class WorkspaceSecrets {
  async keys(workspaceId: string): Promise<string[]> {
    return readIndex(workspaceId).env;
  }

  async storeEnv(workspaceId: string, key: string, value: string) {
    if (!ENV_KEY_PATTERN.test(key)) throw new Error("Invalid environment key.");
    await keychainWrite(account(workspaceId, "env", key), value);
    const index = readIndex(workspaceId);
    if (!index.env.includes(key)) {
      index.env.push(key);
      index.env.sort();
      writeIndex(workspaceId, index);
    }
  }

  async storeFile(workspaceId: string, requestedPath: string, value: string) {
    const name = safeFileName(requestedPath);
    await keychainWrite(account(workspaceId, "file", name), value);
    const index = readIndex(workspaceId);
    if (!index.files.includes(name)) {
      index.files.push(name);
      index.files.sort();
      writeIndex(workspaceId, index);
    }
    await this.materialize(workspaceId);
    return join(workspaceRoot(workspaceId), ".runtime", "files", name);
  }

  async materialize(workspaceId: string): Promise<Record<string, string>> {
    const root = workspaceRoot(workspaceId);
    const runtime = join(root, ".runtime");
    const files = join(runtime, "files");
    const gcloud = join(root, "gcloud");
    ensurePrivateDirectory(root);
    ensurePrivateDirectory(runtime);
    ensurePrivateDirectory(files);
    ensurePrivateDirectory(gcloud);

    const index = readIndex(workspaceId);
    const values = await Promise.all(
      index.env.map(
        async (key) =>
          [key, await keychainRead(account(workspaceId, "env", key))] as const,
      ),
    );
    const environment = Object.fromEntries(
      values.filter(
        (entry): entry is readonly [string, string] => entry[1] !== null,
      ),
    );
    const envPath = join(runtime, "secrets.env");
    const temporary = `${envPath}.tmp`;
    writeFileSync(
      temporary,
      `${Object.entries(environment)
        .map(([key, value]) => `${key}=${shellValue(value)}`)
        .join("\n")}\n`,
      { mode: 0o600 },
    );
    renameSync(temporary, envPath);
    chmodSync(envPath, 0o600);

    await Promise.all(
      index.files.map(async (name) => {
        const value = await keychainRead(account(workspaceId, "file", name));
        if (value === null) return;
        const path = join(files, name);
        writeFileSync(path, value, { mode: 0o600 });
        chmodSync(path, 0o600);
      }),
    );

    const adc = join(gcloud, "application_default_credentials.json");
    return {
      ...environment,
      MARKETER_WORKSPACE_DIR: root,
      MARKETER_SECRETS_FILE: envPath,
      CLOUDSDK_CONFIG: gcloud,
      GOOGLE_APPLICATION_CREDENTIALS: adc,
    };
  }

  async refresh(workspaceId: string) {
    const runtime = join(workspaceRoot(workspaceId), ".runtime");
    if (existsSync(runtime)) await this.materialize(workspaceId);
  }

  lock(workspaceId: string) {
    rmSync(join(workspaceRoot(workspaceId), ".runtime"), {
      recursive: true,
      force: true,
    });
  }

  lockAll() {
    const root = join(homedir(), ".marketer", "workspaces");
    if (!existsSync(root)) return;
    // Avoid retaining a registry of workspace ids. Each hashed directory can
    // be locked without reversing its source organization id.
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        rmSync(join(root, entry.name, ".runtime"), {
          recursive: true,
          force: true,
        });
      }
    }
  }
}

export const workspaceSecrets = new WorkspaceSecrets();
