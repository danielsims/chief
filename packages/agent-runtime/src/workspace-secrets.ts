import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const KEYCHAIN_SERVICE = "com.latentsupply.chief.workspace-secrets";
const LEGACY_KEYCHAIN_SERVICE = "com.latentsupply.marketer.workspace-secrets";
const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;

interface SecretIndex {
  env: string[];
  files: string[];
}

export function workspaceKey(workspaceId: string): string {
  return createHash("sha256").update(workspaceId).digest("hex").slice(0, 24);
}

export function workspaceRoot(workspaceId: string): string {
  const key = workspaceKey(workspaceId);
  const current = join(homedir(), ".chief", "workspaces", key);
  const legacy = join(homedir(), ".marketer", "workspaces", key);
  return !existsSync(current) && existsSync(legacy) ? legacy : current;
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
  for (const service of [KEYCHAIN_SERVICE, LEGACY_KEYCHAIN_SERVICE]) {
    try {
      const { stdout } = await execFileAsync(
        "/usr/bin/security",
        ["find-generic-password", "-a", accountName, "-s", service, "-w"],
        { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
      );
      return stdout.replace(/\n$/, "");
    } catch {
      // Existing installs stored workspace secrets under the previous service.
    }
  }
  return null;
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

async function keychainDelete(accountName: string) {
  await Promise.all(
    [KEYCHAIN_SERVICE, LEGACY_KEYCHAIN_SERVICE].map(async (service) => {
      try {
        await execFileAsync(
          "/usr/bin/security",
          ["delete-generic-password", "-a", accountName, "-s", service],
          { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
        );
      } catch {
        // Missing entries are already in the requested state.
      }
    }),
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
  // materialize (create .runtime) and lock (delete .runtime) race when a
  // session closes while its replacement opens; per-workspace serialization
  // keeps the directory's lifecycle linear.
  private queues = new Map<string, Promise<unknown>>();

  private serialize<T>(
    workspaceId: string,
    task: () => T | Promise<T>,
  ): Promise<T> {
    const prior = this.queues.get(workspaceId) ?? Promise.resolve();
    const next = prior.then(task, task);
    this.queues.set(
      workspaceId,
      next.catch(() => {}),
    );
    return next;
  }

  async keys(workspaceId: string): Promise<string[]> {
    return readIndex(workspaceId).env;
  }

  async readEnv(workspaceId: string, keys: string[]) {
    const available = new Set(readIndex(workspaceId).env);
    const entries = await Promise.all(
      keys
        .filter((key) => available.has(key))
        .map(
          async (key) =>
            [
              key,
              await keychainRead(account(workspaceId, "env", key)),
            ] as const,
        ),
    );
    return Object.fromEntries(
      entries.filter((entry): entry is readonly [string, string] =>
        Boolean(entry[1]),
      ),
    );
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

  async deleteEnv(workspaceId: string, key: string) {
    if (!ENV_KEY_PATTERN.test(key)) throw new Error("Invalid environment key.");
    await keychainDelete(account(workspaceId, "env", key));
    const index = readIndex(workspaceId);
    if (index.env.includes(key)) {
      index.env = index.env.filter((candidate) => candidate !== key);
      writeIndex(workspaceId, index);
    }
    await this.refresh(workspaceId);
  }

  /**
   * Client-owned protocol credentials that must never be projected into an
   * agent process. These records live in Keychain but deliberately stay out of
   * secret-index.json and the materialized workspace environment.
   */
  async readPrivate(workspaceId: string, name: string) {
    return keychainRead(account(workspaceId, "file", safeFileName(name)));
  }

  async storePrivate(workspaceId: string, name: string, value: string) {
    await keychainWrite(
      account(workspaceId, "file", safeFileName(name)),
      value,
    );
  }

  async deletePrivate(workspaceId: string, name: string) {
    await keychainDelete(account(workspaceId, "file", safeFileName(name)));
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

  materialize(workspaceId: string): Promise<Record<string, string>> {
    return this.serialize(workspaceId, () => this.materializeNow(workspaceId));
  }

  private async materializeNow(
    workspaceId: string,
  ): Promise<Record<string, string>> {
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
    for (const [key, value] of Object.entries(environment)) {
      if (key.startsWith("MARKETER_")) {
        environment[`CHIEF_${key.slice("MARKETER_".length)}`] ??= value;
      }
    }
    for (const [target, source] of [
      ["GOOGLE_ANALYTICS_CLIENT_ID", "CHIEF_GOOGLE_OAUTH_CLIENT_ID"],
      ["GOOGLE_ANALYTICS_CLIENT_SECRET", "CHIEF_GOOGLE_OAUTH_CLIENT_SECRET"],
      ["CHIEF_GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_ANALYTICS_CLIENT_ID"],
      ["CHIEF_GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_ANALYTICS_CLIENT_SECRET"],
    ] as const) {
      const value = environment[source];
      if (!environment[target] && value) environment[target] = value;
    }
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
      CHIEF_WORKSPACE_DIR: root,
      CHIEF_SECRETS_FILE: envPath,
      CLOUDSDK_CONFIG: gcloud,
      GOOGLE_APPLICATION_CREDENTIALS: adc,
    };
  }

  async refresh(workspaceId: string) {
    const runtime = join(workspaceRoot(workspaceId), ".runtime");
    if (existsSync(runtime)) await this.materialize(workspaceId);
  }

  lock(workspaceId: string): Promise<void> {
    return this.serialize(workspaceId, () => {
      rmSync(join(workspaceRoot(workspaceId), ".runtime"), {
        recursive: true,
        force: true,
      });
    });
  }

  lockAll() {
    for (const root of [
      join(homedir(), ".chief", "workspaces"),
      join(homedir(), ".marketer", "workspaces"),
    ]) {
      if (!existsSync(root)) continue;
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
}

export const workspaceSecrets = new WorkspaceSecrets();
