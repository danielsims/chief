import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { DriverType, ProviderModelOption } from "./types.js";

const CACHE_TTL_MS = 30_000;
const cache = new Map<
  DriverType,
  { at: number; models: ProviderModelOption[] }
>();

function binary(name: DriverType) {
  const upper = name.toUpperCase();
  const packageCodex = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "node_modules",
    ".bin",
    "codex",
  );
  const candidates = [
    process.env[`${upper}_PATH`],
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
  const files: Array<{ path: string; modified: number }> = [];
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
  return withTimeout(
    new Promise((resolve, reject) => {
      const child = spawn(binary("codex"), ["app-server"], {
        cwd: homedir(),
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let buffer = "";
      let nextId = 0;
      const pending = new Map<
        number,
        { resolve: (value: unknown) => void; reject: (error: Error) => void }
      >();
      const stop = () => child.kill("SIGTERM");
      child.on("error", reject);
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
            clientInfo: { name: "marketer", version: "0.1.0" },
          });
          child.stdin.write(
            `${JSON.stringify({ method: "initialized", params: {} })}\n`,
          );
          const result = (await request("model/list")) as Record<
            string,
            unknown
          >;
          const candidates = [
            result,
            result?.data,
            result?.models,
            (result?.data as Record<string, unknown> | undefined)?.models,
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
          stop();
          resolve(
            [...new Set(values)].map((value) => ({
              value,
              label: label(value),
            })),
          );
        } catch (error) {
          stop();
          reject(error);
        }
      })();
    }),
    10_000,
  );
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
    else discovered = await commandModels(binary("opencode"), ["models"]);
  } catch (error) {
    console.error(`[models] ${driver}:`, error);
  }
  const models = [{ value: "", label: "Auto" }, ...discovered];
  cache.set(driver, { at: Date.now(), models });
  return models;
}
