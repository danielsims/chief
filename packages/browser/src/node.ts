import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
  AgentBrowserCursorPosition,
  AgentBrowserSessionOptions,
  AgentBrowserSnapshot,
  AgentBrowserSnapshotRef,
  AgentBrowserStream,
} from "./node-support.js";
import {
  agentBrowserExecutable,
  browserSnapshotLabel,
  browserSnapshotRef,
  browserSnapshotRefLine,
  commandError,
  normalizedBrowserLabel,
  parseJson,
  safeSessionId,
} from "./node-support.js";

export * from "./node-support.js";

const execFileAsync = promisify(execFile);

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
            ...(this.options.encryptionKey
              ? {
                  AGENT_BROWSER_ENCRYPTION_KEY: this.options.encryptionKey,
                }
              : {}),
            AGENT_BROWSER_CONFIG: this.configPath,
            AGENT_BROWSER_DEFAULT_TIMEOUT: "20000",
            AGENT_BROWSER_EXTENSIONS: "",
            AGENT_BROWSER_HEADED: "false",
            AGENT_BROWSER_IDLE_TIMEOUT_MS: "30m",
            ...(this.options.restore
              ? { AGENT_BROWSER_AUTOSAVE_INTERVAL_MS: "5000" }
              : {}),
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
    timeout = 60_000,
  ): Promise<AgentBrowserStream> {
    await this.command(["open", url], timeout);
    if (viewport) await this.setViewport(viewport.width, viewport.height);
    return this.stream();
  }

  async stream(timeout = 30_000): Promise<AgentBrowserStream> {
    const status = await this.command<{
      connected: boolean;
      enabled: boolean;
      port: number;
      screencasting: boolean;
    }>(["stream", "status"], timeout);
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
          `The browser control "${targetName}" did not become selected.`,
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

  /** Remove the encrypted auto-restore state for this named session. */
  async clearSavedState() {
    await this.command(["state", "clear", this.sessionId]);
  }
}
