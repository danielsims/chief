import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const agentBrowserEntry = require.resolve("agent-browser/bin/agent-browser.js");

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
  return join(directory, executable);
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
    const result = await this.command<{ snapshot?: string }>([
      "snapshot",
      "--interactive",
      "--compact",
    ]);
    const [url, title] = await Promise.all([this.getUrl(), this.getTitle()]);
    return { snapshot: result.snapshot ?? JSON.stringify(result), title, url };
  }

  async click(labels: string[]) {
    return this.trySemanticCommands(
      labels.flatMap((label) =>
        label.startsWith("@")
          ? [["click", label]]
          : [
              ["find", "role", "button", "click", "--name", label],
              ["find", "role", "link", "click", "--name", label],
              ["find", "text", label, "click"],
            ],
      ),
    );
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
    await this.command([
      "set",
      "viewport",
      String(Math.max(320, Math.round(width))),
      String(Math.max(240, Math.round(height))),
      "2",
    ]);
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
