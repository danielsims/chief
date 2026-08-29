import { randomUUID } from "node:crypto";
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const agentBrowserEntry = require.resolve("agent-browser/bin/agent-browser.js");

/**
 * Resolve the agent-browser native client, ensuring it is executable.
 *
 * The binary ships inside the packaged runtime, which can live on a read-only
 * filesystem (a mounted DMG) where an in-place chmod fails. Browser automation
 * is a core Chief primitive, so never depend on the bundle being writable:
 * copy the client once into a user-writable cache directory and run the copy.
 */
function resolveAgentBrowserExecutable() {
  const directory = dirname(agentBrowserEntry);
  const platform = process.platform === "win32" ? "win32" : process.platform;
  const architecture = process.arch === "x64" ? "x64" : process.arch;
  const extension = process.platform === "win32" ? ".exe" : "";
  const executable = readdirSync(directory).find(
    (entry) =>
      entry.startsWith(`agent-browser-${platform}`) &&
      entry.endsWith(`-${architecture}${extension}`),
  );
  if (!executable) {
    throw new Error(
      `agent-browser does not include a native client for ${process.platform}-${process.arch}.`,
    );
  }
  const source = join(directory, executable);
  if (process.platform === "win32") return source;

  // Prefer the bundled binary when it is already executable; otherwise stage a
  // writable copy so read-only installs (DMG) still get a working browser.
  try {
    accessSync(source, constants.X_OK);
    return source;
  } catch {
    // fall through to a staged copy
  }

  const cacheDir = join(
    process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
    "chief",
    "agent-browser",
  );
  const versionMarker = join(cacheDir, "source.txt");
  let cachedSource = "";
  try {
    cachedSource = readFileSync(versionMarker, "utf8");
  } catch {
    cachedSource = "";
  }
  const target = join(cacheDir, executable);
  if (cachedSource !== source || !isExecutable(target)) {
    mkdirSync(cacheDir, { recursive: true });
    const temporary = join(
      cacheDir,
      `${executable}.${process.pid}.${randomUUID()}.tmp`,
    );
    copyFileSync(source, temporary);
    try {
      chmodSync(temporary, 0o755);
      accessSync(temporary, constants.X_OK);
      copyFileSync(temporary, target);
      chmodSync(target, 0o755);
      writeFileSync(versionMarker, source);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  return target;
}

function isExecutable(path: string) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export const agentBrowserExecutable = resolveAgentBrowserExecutable();

export type BrowserBoundaryValue =
  | boolean
  | BrowserBoundaryRecord
  | BrowserBoundaryValue[]
  | null
  | number
  | string;

export interface BrowserBoundaryRecord {
  readonly [key: string]: BrowserBoundaryValue;
}

function isBrowserBoundaryValue(value: unknown): value is BrowserBoundaryValue {
  if (value === null) return true;
  if (Array.isArray(value)) return value.every(isBrowserBoundaryValue);
  if (value instanceof Object) {
    return Object.values(value).every(isBrowserBoundaryValue);
  }
  return (
    value === true ||
    value === false ||
    (Number(value) === value && Number.isFinite(Number(value))) ||
    parseBrowserText(value) !== undefined
  );
}

export function parseBrowserText(value: unknown): string | undefined {
  const text = String(value);
  return text === value ? text : undefined;
}

export function parseBrowserBoolean(value: BrowserBoundaryValue | undefined) {
  return value === true ? true : value === false ? false : undefined;
}

export function isBrowserRecord(
  value: unknown,
): value is BrowserBoundaryRecord {
  return Object(value) === value && !Array.isArray(value);
}

export interface AgentBrowserSessionOptions {
  sessionId: string;
  downloadPath: string;
  /** AES-256-GCM key used by agent-browser for encrypted restore state. */
  encryptionKey?: string;
  executablePath?: string;
  extensions?: string[];
  allowedDomains?: string[];
  autoConnect?: boolean;
  cdp?: number | string;
  profile?: string;
  restore?: boolean | string;
  colorScheme?: "dark" | "light" | "no-preference";
}

export interface AgentBrowserStream {
  connected: boolean;
  enabled: boolean;
  port: number;
  screencasting: boolean;
  url: string;
}

export interface AgentBrowserSnapshot {
  snapshot: string;
  url: string;
  title: string;
}

export interface AgentBrowserSnapshotRef {
  name?: string;
  role?: string;
}

const interactiveRolePriority = new Map([
  ["radio", 0],
  ["checkbox", 1],
  ["button", 2],
  ["link", 3],
  ["tab", 4],
  ["option", 5],
]);

export function normalizedBrowserLabel(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function canonicalBrowserRef(value: string) {
  const match = /^@?(e\d+)$/i.exec(value.trim());
  return match?.[1] ? `@${match[1].toLocaleLowerCase()}` : undefined;
}

/** Resolve a semantic tool label to the latest snapshot ref for cursor UI and resilient clicking. */
export function browserSnapshotRef(
  labels: string[],
  refs: Record<string, AgentBrowserSnapshotRef>,
) {
  const direct = labels.map(canonicalBrowserRef).find(Boolean);
  if (direct) return direct;
  const candidates = Object.entries(refs)
    .filter(
      ([, ref]) => ref.name && interactiveRolePriority.has(ref.role ?? ""),
    )
    .map(([id, ref]) => ({
      id,
      name: normalizedBrowserLabel(ref.name ?? ""),
      priority: interactiveRolePriority.get(ref.role ?? "") ?? 99,
    }));
  for (const label of labels) {
    const target = normalizedBrowserLabel(label);
    if (!target) continue;
    const match = candidates
      .filter(
        (candidate) =>
          candidate.name === target ||
          candidate.name.startsWith(target) ||
          candidate.name.includes(target),
      )
      .sort(
        (left, right) =>
          Number(left.name !== target) - Number(right.name !== target) ||
          left.priority - right.priority ||
          left.name.length - right.name.length,
      )[0];
    if (match) return `@${match.id}`;
  }
  return undefined;
}

/** Keep snapshot selectors internal while exposing the element's accessible name. */
export function browserSnapshotLabel(
  labels: string[],
  refs: Record<string, AgentBrowserSnapshotRef>,
) {
  const ref = browserSnapshotRef(labels, refs)?.slice(1);
  const resolved = ref ? refs[ref]?.name?.trim() : undefined;
  if (resolved) return resolved;
  return labels.find((label) => !canonicalBrowserRef(label))?.trim();
}

export function browserSnapshotRefLine(snapshot: string, ref: string) {
  const id = ref.replace(/^@/, "");
  return snapshot.split("\n").find((line) => line.includes(`ref=${id}`));
}

export interface AgentBrowserCursorPosition {
  x: number;
  y: number;
}

/**
 * Resolve Chrome's last active profile directory without reading cookies,
 * history, credentials, or extension data. agent-browser copies the selected
 * profile into a temporary directory before launch, so the original remains
 * untouched.
 */
export function lastUsedChromeProfile(
  localStatePath = defaultChromeLocalStatePath(),
): string | undefined {
  if (!localStatePath) return undefined;
  try {
    const state: unknown = JSON.parse(readFileSync(localStatePath, "utf8"));
    if (!isBrowserRecord(state) || !isBrowserRecord(state.profile)) {
      return undefined;
    }
    const profile = parseBrowserText(state.profile.last_used)?.trim();
    return profile === "" ? undefined : profile;
  } catch {
    return undefined;
  }
}

function defaultChromeLocalStatePath() {
  if (process.platform === "darwin") {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "Google",
      "Chrome",
      "Local State",
    );
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    return localAppData
      ? join(localAppData, "Google", "Chrome", "User Data", "Local State")
      : undefined;
  }
  return join(homedir(), ".config", "google-chrome", "Local State");
}

export function safeSessionId(value: string) {
  const safe = value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);
  if (!safe) throw new Error("A browser session ID is required.");
  return safe;
}

export function parseJson(output: string): BrowserBoundaryValue {
  const value: unknown = JSON.parse(output);
  if (!isBrowserBoundaryValue(value)) {
    throw new Error("agent-browser returned unsupported JSON.");
  }
  if (!isBrowserRecord(value)) return value;
  if (parseBrowserBoolean(value.success) === false) {
    throw new Error(parseBrowserText(value.error) ?? "agent-browser failed");
  }
  return value.data ?? value;
}

export function parseCommandError(error: unknown) {
  if (!isBrowserRecord(error)) return new Error(String(error));
  const detail = [
    parseBrowserText(error.stderr)?.trim(),
    parseBrowserText(error.stdout)?.trim(),
    parseBrowserText(error.message),
  ].find((candidate) => candidate);
  return new Error(detail ?? "agent-browser command failed");
}
