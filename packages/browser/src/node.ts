import { execFile } from "node:child_process";
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
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
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

const agentBrowserExecutable = resolveAgentBrowserExecutable();

interface AgentBrowserEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
}

export interface AgentBrowserSessionOptions {
  sessionId: string;
  downloadPath: string;
  executablePath?: string;
  extensions?: string[];
  allowedDomains?: string[];
  autoConnect?: boolean;
  cdp?: number | string;
  profile?: string;
  restore?: boolean;
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

function normalizedBrowserLabel(value: string) {
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

function browserSnapshotRefLine(snapshot: string, ref: string) {
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
    const state = JSON.parse(readFileSync(localStatePath, "utf8")) as {
      profile?: { last_used?: unknown };
    };
    const profile = state.profile?.last_used;
    return typeof profile === "string" && profile.trim()
      ? profile.trim()
      : undefined;
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

function safeSessionId(value: string) {
  const safe = value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);
  if (!safe) throw new Error("A browser session ID is required.");
  return safe;
}

function parseJson<T>(output: string): T {
  const value = JSON.parse(output) as AgentBrowserEnvelope<T> | T;
  if (
    value &&
    typeof value === "object" &&
    "success" in value &&
    value.success === false
  ) {
    const message =
      "error" in value && typeof value.error === "string"
        ? value.error
        : "agent-browser failed";
    throw new Error(message);
  }
  if (value && typeof value === "object" && "data" in value) {
    return value.data as T;
  }
  return value as T;
}

function commandError(error: unknown) {
  if (!error || typeof error !== "object") return new Error(String(error));
  const result = error as {
    message?: string;
    stderr?: string;
    stdout?: string;
  };
  const detail = [
    result.stderr?.trim(),
    result.stdout?.trim(),
    result.message,
  ].find((candidate) => candidate);
  return new Error(detail ?? "agent-browser command failed");
}

/**
 * A small, host-neutral client for an official agent-browser session.
 * The browser daemon owns Chrome; consumers can concurrently use the CLI while
 * a human interacts through the WebSocket viewport.
 */
export class AgentBrowserSession {
  private commandQueue: Promise<void> = Promise.resolve();
  private readonly configPath: string;
  readonly downloadPath: string;
  readonly sessionId: string;
  private readonly options: AgentBrowserSessionOptions;
  private snapshotRefs: Record<string, AgentBrowserSnapshotRef> = {};
  private viewport: { width: number; height: number } | null = null;

  constructor(options: AgentBrowserSessionOptions) {
    this.options = options;
    this.sessionId = safeSessionId(options.sessionId);
    this.downloadPath = options.downloadPath;
    this.configPath = join(this.downloadPath, "agent-browser.json");
  }

  private globalArgs() {
    const args = [
      "--session",
      this.sessionId,
      "--config",
      this.configPath,
      "--headed",
      "false",
      "--json",
      "--content-boundaries",
      "--download-path",
      this.downloadPath,
      "--color-scheme",
      this.options.colorScheme ?? "dark",
    ];
    if (this.options.restore === true) args.push("--restore");
    if (this.options.executablePath) {
      args.push("--executable-path", this.options.executablePath);
    }
    for (const extension of this.options.extensions ?? []) {
      args.push("--extension", extension);
    }
    if (this.options.allowedDomains?.length) {
      args.push("--allowed-domains", this.options.allowedDomains.join(","));
    }
    if (this.options.autoConnect) args.push("--auto-connect");
    if (this.options.cdp !== undefined) {
      args.push("--cdp", String(this.options.cdp));
    }
    if (this.options.profile) args.push("--profile", this.options.profile);
    return args;
  }

  command<T>(args: string[], timeout = 30_000): Promise<T> {
    const task = this.commandQueue
      .catch(() => undefined)
      .then(() => this.runCommand<T>(args, timeout));
    this.commandQueue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async runCommand<T>(args: string[], timeout: number): Promise<T> {
    await mkdir(this.downloadPath, { recursive: true });
    await writeFile(this.configPath, '{"headed":false}\n', {
      flag: "wx",
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    try {
      const { stdout } = await execFileAsync(
        agentBrowserExecutable,
        [...this.globalArgs(), ...args],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            AGENT_BROWSER_CONFIG: this.configPath,
            AGENT_BROWSER_DEFAULT_TIMEOUT: "20000",
            AGENT_BROWSER_EXTENSIONS: "",
            AGENT_BROWSER_HEADED: "false",
            AGENT_BROWSER_IDLE_TIMEOUT_MS: "30m",
          },
          maxBuffer: 10 * 1024 * 1024,
          timeout,
        },
      );
      return parseJson<T>(stdout.trim());
    } catch (error) {
      throw commandError(error);
    }
  }

  async open(
    url: string,
    viewport?: { width: number; height: number },
  ): Promise<AgentBrowserStream> {
    await this.command(["open", url], 60_000);
    if (viewport) await this.setViewport(viewport.width, viewport.height);
    return this.stream();
  }

  async stream(): Promise<AgentBrowserStream> {
    const status = await this.command<{
      connected: boolean;
      enabled: boolean;
      port: number;
      screencasting: boolean;
    }>(["stream", "status"]);
    if (!status.enabled || !status.port) {
      throw new Error("agent-browser streaming is unavailable.");
    }
    return { ...status, url: `ws://localhost:${status.port}` };
  }

  async getUrl() {
    const result = await this.command<{ url?: string; value?: string }>([
      "get",
      "url",
    ]);
    return result.url ?? result.value ?? JSON.stringify(result);
  }

  async getTitle() {
    const result = await this.command<{ title?: string; value?: string }>([
      "get",
      "title",
    ]);
    return result.title ?? result.value ?? "";
  }

  async snapshot(): Promise<AgentBrowserSnapshot> {
    const result = await this.command<{
      snapshot?: string;
      refs?: Record<string, AgentBrowserSnapshotRef>;
    }>(["snapshot", "--interactive", "--compact"]);
    this.snapshotRefs = result.refs ?? {};
    const [url, title] = await Promise.all([this.getUrl(), this.getTitle()]);
    return { snapshot: result.snapshot ?? JSON.stringify(result), title, url };
  }

  async cursorFor(
    labels: string[],
  ): Promise<AgentBrowserCursorPosition | undefined> {
    const ref = browserSnapshotRef(labels, this.snapshotRefs);
    const viewport = this.viewport;
    if (!ref || !viewport) return undefined;
    const box = await this.command<{
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    }>(["get", "box", ref]).catch(() => undefined);
    const { x, y, width, height } = box ?? {};
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof width !== "number" ||
      typeof height !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) {
      return undefined;
    }
    const normalizedX = (x + width / 2) / viewport.width;
    const normalizedY = (y + height / 2) / viewport.height;
    return {
      x: Math.max(0, Math.min(1, normalizedX)),
      y: Math.max(0, Math.min(1, normalizedY)),
    };
  }

  labelFor(labels: string[]) {
    return browserSnapshotLabel(labels, this.snapshotRefs);
  }

  /**
   * Put the semantic target inside the stable desktop viewport before the UI
   * animates its remote cursor. Product configurators commonly use sticky
   * headers, so clicking a cached off-screen box is not safe.
   */
  async prepareInteraction(labels: string[]) {
    let ref = browserSnapshotRef(labels, this.snapshotRefs);
    if (!ref) {
      await this.snapshot();
      ref = browserSnapshotRef(labels, this.snapshotRefs);
    }
    if (ref) {
      await this.command(["scrollintoview", ref]).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 120));
      await this.snapshot();
    }
    return {
      label: browserSnapshotLabel(labels, this.snapshotRefs),
      cursor: await this.cursorFor(labels),
    };
  }

  async click(labels: string[]) {
    await this.prepareInteraction(labels);
    const snapshotRef = browserSnapshotRef(labels, this.snapshotRefs);
    const target = snapshotRef
      ? this.snapshotRefs[snapshotRef.replace(/^@/, "")]
      : undefined;
    const targetName = target?.name?.trim();
    const normalizedTargetName = normalizedBrowserLabel(targetName ?? "");
    const associatedLabelRefs = targetName
      ? Object.entries(this.snapshotRefs)
          .filter(([id, ref]) => {
            const normalizedLabelName = normalizedBrowserLabel(ref.name ?? "");
            return (
              `@${id}` !== snapshotRef &&
              ref.role === "LabelText" &&
              (normalizedLabelName === normalizedTargetName ||
                normalizedLabelName.startsWith(normalizedTargetName) ||
                normalizedTargetName.startsWith(normalizedLabelName))
            );
          })
          .map(([id]) => `@${id}`)
      : [];
    const commands = [
      ...(snapshotRef ? [["click", snapshotRef]] : []),
      ...associatedLabelRefs.map((ref) => ["click", ref]),
      ...labels.flatMap((label) =>
        label.startsWith("@")
          ? [["click", label]]
          : [
              ...["radio", "checkbox", "button", "link", "tab", "option"].map(
                (role) => ["find", "role", role, "click", "--name", label],
              ),
              ["find", "label", label, "click"],
              ["find", "text", label, "click"],
            ],
      ),
    ];
    if (target?.role !== "radio" || !targetName) {
      return this.trySemanticCommands(commands);
    }

    let lastError: unknown;
    for (const command of commands) {
      try {
        await this.command(command);
        if (await this.waitForRadioSelection(targetName)) return true;
        lastError = new Error(
          `The browser control \"${targetName}\" did not become selected.`,
        );
      } catch (error) {
        lastError = error;
      }
    }
    throw commandError(lastError);
  }

  private async waitForRadioSelection(name: string) {
    for (const delay of [120, 240, 400, 650]) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      const snapshot = await this.snapshot();
      const ref = browserSnapshotRef([name], this.snapshotRefs);
      const line = ref ? browserSnapshotRefLine(snapshot.snapshot, ref) : null;
      if (line?.includes("checked=true")) return true;
    }
    return false;
  }

  async fill(labels: string[], value: string) {
    return this.trySemanticCommands(
      labels.flatMap((label) =>
        label.startsWith("@")
          ? [["fill", label, value]]
          : [
              ["find", "label", label, "fill", value],
              ["find", "placeholder", label, "fill", value],
              ["find", "role", "textbox", "fill", value, "--name", label],
            ],
      ),
    );
  }

  async select(labels: string[], values: string[]) {
    return this.trySemanticCommands(
      labels.flatMap((label) =>
        label.startsWith("@")
          ? [["select", label, ...values]]
          : [["find", "label", label, "select", ...values]],
      ),
    );
  }

  private async trySemanticCommands(commands: string[][]) {
    let lastError: unknown;
    for (const command of commands) {
      try {
        await this.command(command);
        return true;
      } catch (error) {
        lastError = error;
      }
    }
    throw commandError(lastError);
  }

  async reload() {
    await this.command(["reload"]);
  }

  async press(key: string) {
    await this.command(["press", key]);
  }

  async setViewport(width: number, height: number) {
    const viewport = {
      width: Math.max(320, Math.round(width)),
      height: Math.max(240, Math.round(height)),
    };
    await this.command([
      "set",
      "viewport",
      String(viewport.width),
      String(viewport.height),
      "2",
    ]);
    this.viewport = viewport;
  }

  async waitForUrl(pattern: string, timeout = 15 * 60_000) {
    await this.command(["wait", "--url", pattern], timeout);
    return this.getUrl();
  }

  async waitForFunction(expression: string, timeout = 30_000) {
    await this.command(["wait", "--fn", expression], timeout);
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.command<{ result: T }>(["eval", expression]);
    return result.result;
  }

  async close() {
    await this.command(["close"]);
  }
}
