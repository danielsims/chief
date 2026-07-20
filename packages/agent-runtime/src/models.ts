import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { DriverType, ProviderModelOption } from "./types.js";

const moduleDirectory =
  typeof __dirname === "string"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));

const CACHE_TTL_MS = 30_000;
const cache = new Map<
  DriverType,
  { at: number; models: ProviderModelOption[] }
>();
let codexModelsInFlight: Promise<ProviderModelOption[]> | undefined;
let gatewayModelsInFlight: Promise<ProviderModelOption[]> | undefined;

function binary(name: DriverType) {
  const upper = name.toUpperCase();
  const bundledBinary =
    name === "codex" ? process.env.CHIEF_CODEX_BINARY : undefined;
  const packageCodex = join(
    moduleDirectory,
    "..",
    "node_modules",
    ".bin",
    "codex",
  );
  const candidates = [
    process.env[`${upper}_PATH`],
    bundledBinary,
    name === "codex" ? packageCodex : undefined,
    join(homedir(), `.${name}`, "bin", name),
    join(homedir(), ".local", "bin", name),
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
  ].filter((value): value is string => Boolean(value));
  return candidates.find(existsSync) ?? name;
}

function label(value: string) {
  if (value === "") return "Auto";
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => {
      if (part.toLowerCase() === "gpt") return "GPT";
      if (part.toLowerCase() === "claude") return "Claude";
      return /^\d/.test(part)
        ? part
        : part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function claudeModels(): ProviderModelOption[] {
  const root = join(homedir(), ".claude", "projects");
  if (!existsSync(root)) return [];
  const files: { path: string; modified: number }[] = [];
  for (const project of readdirSync(root)) {
    const directory = join(root, project);
    let names: string[] = [];
    try {
      names = readdirSync(directory);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const path = join(directory, name);
      try {
        files.push({ path, modified: statSync(path).mtimeMs });
      } catch {
        // A session can disappear while discovery is running.
      }
    }
  }
  files.sort((a, b) => b.modified - a.modified);
  const found = new Set<string>();
  for (const file of files.slice(0, 50)) {
    let lines: string[];
    try {
      lines = readFileSync(file.path, "utf8").split("\n");
    } catch {
      continue;
    }
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        const model = JSON.parse(lines[index]!)?.message?.model;
        if (
          typeof model === "string" &&
          model &&
          !model.startsWith("<") &&
          !model.includes("synthetic")
        ) {
          found.add(model);
        }
      } catch {
        // Ignore non-record lines.
      }
      if (found.size >= 20) break;
    }
    if (found.size >= 20) break;
  }
  return [...found].map((value) => ({ value, label: label(value) }));
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Model discovery timed out.")),
      milliseconds,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function commandModels(
  executable: string,
  args: string[],
): Promise<ProviderModelOption[]> {
  return withTimeout(
    new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        cwd: homedir(),
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += String(chunk)));
      child.stderr.on("data", (chunk) => (stderr += String(chunk)));
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code !== 0) {
          reject(new Error(stderr || `Model discovery exited ${code}.`));
          return;
        }
        let values: string[] = [];
        try {
          const parsed = JSON.parse(stdout) as unknown;
          const records = Array.isArray(parsed)
            ? parsed
            : parsed && typeof parsed === "object" && "models" in parsed
              ? ((parsed as { models?: unknown[] }).models ?? [])
              : [];
          values = records.flatMap((record) => {
            if (typeof record === "string") return [record];
            if (!record || typeof record !== "object") return [];
            const item = record as Record<string, unknown>;
            const value = item.id ?? item.model ?? item.value;
            return typeof value === "string" ? [value] : [];
          });
        } catch {
          values = stdout
            .split("\n")
            .map((value) => value.trim())
            .filter(Boolean);
        }
        resolve(
          [...new Set(values)].map((value) => ({
            value,
            label: label(value),
          })),
        );
      });
    }),
    10_000,
  );
}

function codexModels(): Promise<ProviderModelOption[]> {
  if (codexModelsInFlight) return codexModelsInFlight;
  const discovery = new Promise<ProviderModelOption[]>((resolve, reject) => {
    const codexHome = mkdtempSync(join(tmpdir(), "chief-codex-models-"));
    const child = spawn(binary("codex"), ["app-server"], {
      cwd: homedir(),
      env: { ...process.env, CODEX_HOME: codexHome },
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
    let buffer = "";
    let nextId = 0;
    let settled = false;
    let stderr = "";
    const pending = new Map<
      number,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >();
    const stop = () => {
      child.stdin.end();
      if (!child.pid) return;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    };
    const finish = (
      outcome: { models: ProviderModelOption[] } | { error: Error },
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      for (const request of pending.values()) {
        request.reject(
          "error" in outcome
            ? outcome.error
            : new Error("Model discovery stopped."),
        );
      }
      pending.clear();
      stop();
      if ("error" in outcome) reject(outcome.error);
      else resolve(outcome.models);
    };
    const timeout = setTimeout(
      () => finish({ error: new Error("Model discovery timed out.") }),
      15_000,
    );
    timeout.unref();
    child.on("error", (error) => finish({ error }));
    child.on("exit", (code) => {
      rmSync(codexHome, { recursive: true, force: true });
      if (!settled) {
        finish({
          error: new Error(
            stderr.trim() || `Codex model discovery exited ${code}.`,
          ),
        });
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-2_000);
    });
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const message = JSON.parse(line) as {
            id?: number;
            result?: unknown;
            error?: { message?: string };
          };
          if (message.id === undefined) continue;
          const request = pending.get(message.id);
          if (!request) continue;
          pending.delete(message.id);
          if (message.error) {
            request.reject(new Error(message.error.message ?? "RPC error"));
          } else request.resolve(message.result);
        } catch {
          // Ignore diagnostics written to stdout.
        }
      }
    });
    const request = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<unknown>((done, fail) => {
        const id = ++nextId;
        pending.set(id, { resolve: done, reject: fail });
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      });
    void (async () => {
      try {
        await request("initialize", {
          clientInfo: { name: "chief", version: "0.1.0" },
          capabilities: null,
        });
        child.stdin.write(
          `${JSON.stringify({ method: "initialized", params: {} })}\n`,
        );
        const result = (await request("model/list")) as Record<string, unknown>;
        const candidates = [
          result,
          result.data,
          result.models,
          (result.data as Record<string, unknown> | undefined)?.models,
        ];
        const values = candidates
          .flatMap((candidate) => (Array.isArray(candidate) ? candidate : []))
          .flatMap((record) => {
            if (typeof record === "string") return [record];
            if (!record || typeof record !== "object") return [];
            const item = record as Record<string, unknown>;
            const value = item.model ?? item.id ?? item.name ?? item.slug;
            return typeof value === "string" ? [value] : [];
          });
        finish({
          models: [...new Set(values)].map((value) => ({
            value,
            label: label(value),
          })),
        });
      } catch (error) {
        finish({
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    })();
  });
  codexModelsInFlight = discovery.finally(() => {
    codexModelsInFlight = undefined;
  });
  return codexModelsInFlight;
}

function gatewayModels(): Promise<ProviderModelOption[]> {
  if (gatewayModelsInFlight) return gatewayModelsInFlight;
  gatewayModelsInFlight = withTimeout(
    fetch("https://ai-gateway.vercel.sh/v1/models").then(async (response) => {
      if (!response.ok) {
        throw new Error(
          `Gateway model discovery returned HTTP ${response.status}.`,
        );
      }
      const body = (await response.json()) as {
        data?: {
          id?: unknown;
          name?: unknown;
          description?: unknown;
          context_window?: unknown;
          type?: unknown;
          tags?: unknown;
          pricing?: { input?: unknown; output?: unknown };
        }[];
      };
      return (body.data ?? [])
        .filter(
          (model) =>
            model.type === "language" &&
            typeof model.id === "string" &&
            model.id.length > 0,
        )
        .map((model) => ({
          value: model.id as string,
          label:
            typeof model.name === "string" && model.name
              ? model.name
              : label(model.id as string),
          description:
            typeof model.description === "string"
              ? model.description
              : undefined,
          contextWindow:
            typeof model.context_window === "number"
              ? model.context_window
              : undefined,
          tags: Array.isArray(model.tags)
            ? model.tags.filter((tag): tag is string => typeof tag === "string")
            : undefined,
          pricing: model.pricing
            ? {
                input:
                  typeof model.pricing.input === "string"
                    ? model.pricing.input
                    : undefined,
                output:
                  typeof model.pricing.output === "string"
                    ? model.pricing.output
                    : undefined,
              }
            : undefined,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }),
    10_000,
  ).finally(() => {
    gatewayModelsInFlight = undefined;
  });
  return gatewayModelsInFlight;
}

export async function listModels(
  driver: DriverType,
): Promise<ProviderModelOption[]> {
  const cached = cache.get(driver);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.models;
  let discovered: ProviderModelOption[] = [];
  try {
    if (driver === "claude") discovered = claudeModels();
    else if (driver === "codex") discovered = await codexModels();
    else if (driver === "remote") discovered = await gatewayModels();
    else discovered = await commandModels(binary("opencode"), ["models"]);
  } catch (error) {
    console.error(`[models] ${driver}:`, error);
  }
  const models = [{ value: "", label: "Auto" }, ...discovered];
  cache.set(driver, { at: Date.now(), models });
  return models;
}
