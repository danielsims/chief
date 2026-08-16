import { execFile } from "node:child_process";

import type {
  CredentialRequest,
  ShortLivedCredential,
} from "../project-types.js";

/**
 * A trusted host for Git credentials. Agents request a credential for one
 * scoped operation; the broker acquires it and hands it back for the duration
 * of that operation only. No credential is ever persisted by the broker.
 */
export interface CredentialBroker {
  readonly id: string;
  request(request: CredentialRequest): Promise<ShortLivedCredential>;
}

/** Rejects URLs that try to smuggle a credential, e.g. https://token@host/…. */
export function redactUrlCredentials(value: string) {
  return value.replace(/\/\/([^/@\s]+)@/g, "//***@");
}

/** Redacts each known secret from an arbitrary string (logs, errors, output). */
export function redactSecrets(value: string, secrets: string[]) {
  let redacted = value;
  for (const secret of secrets) {
    if (!secret) continue;
    redacted = redacted.split(secret).join("***");
  }
  return redacted;
}

export function redactRemoteForDisplay(remoteUrl: string) {
  return redactUrlCredentials(remoteUrl.trim());
}

/**
 * Asks the platform Git credential helper in a trusted subprocess and keeps
 * the result only for the caller's one operation. The credential never enters
 * application tables, logs, or the model's tool output.
 */
export class GitCredentialHelperBroker implements CredentialBroker {
  readonly id = "git-credential-helper";

  async request(request: CredentialRequest): Promise<ShortLivedCredential> {
    const input = [
      `protocol=${protocolOf(request.remoteUrl)}`,
      `host=${hostOf(request.remoteUrl)}`,
      `path=${pathOf(request.remoteUrl)}`,
      "",
    ].join("\n");
    const { stdout } = await credentialFill(input);
    const lines = stdout.split("\n");
    const username = valueOf(lines, "username");
    const password = valueOf(lines, "password");
    if (!username || !password) {
      throw new Error("The Git credential flow did not provide credentials.");
    }
    return { username, password };
  }
}

function credentialFill(input: string) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFile(
      "git",
      ["credential", "fill"],
      {
        encoding: "utf8",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              stderr.trim() || "The Git credential flow could not run.",
            ),
          );
          return;
        }
        resolve({ stdout, stderr });
      },
    );
    child.stdin?.end(input);
  });
}

function protocolOf(remoteUrl: string) {
  if (remoteUrl.startsWith("git@") || remoteUrl.startsWith("ssh://")) {
    return "ssh";
  }
  return "https";
}

function hostOf(remoteUrl: string) {
  const match = /^(?:[\w.-]+@)?([\w.-]+)(?::|$)/.exec(remoteUrl);
  if (match?.[1]) return match[1];
  try {
    return new URL(remoteUrl).hostname;
  } catch {
    return "";
  }
}

function pathOf(remoteUrl: string) {
  const match = /^[\w.-]+@[\w.-]+:(.+)$/.exec(remoteUrl);
  if (match?.[1]) return match[1].replace(/\.git$/i, "");
  try {
    return new URL(remoteUrl).pathname
      .replace(/^\/+/, "")
      .replace(/\.git$/i, "");
  } catch {
    return "";
  }
}

function valueOf(lines: string[], key: string) {
  const prefix = `${key}=`;
  for (const line of lines) {
    if (line.startsWith(prefix)) return line.slice(prefix.length);
  }
  return undefined;
}
