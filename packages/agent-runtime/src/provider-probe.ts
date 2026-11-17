import { execFile } from "node:child_process";
import { tmpdir } from "node:os";

import { findClaudeCode } from "./drivers/claude-code-path.js";
import { ensureCodexBinary } from "./drivers/codex-install.js";
import { agentEnvironment } from "./drivers/environment.js";
import { findOpenCode } from "./drivers/opencode-support.js";
import { codexDefaultModel } from "./models.js";

export type ProbedProvider = "codex" | "claude" | "opencode";

export type ProviderProbe =
  | { ok: true }
  | {
      ok: false;
      reason: "missing" | "signed_out" | "usage" | "model" | "failed";
      detail: string;
    };

const PROMPT = "Reply with the single word OK.";
const TIMEOUT_MS = 45_000;

/** Model ids as agent apps name them, e.g. "gpt-6.1-sol" or "opencode-go/kimi". */
const MODEL_PATTERN = /^[\w.:/@[\]-]{1,128}$/u;

/**
 * Sends the agent app one short message on the model Chief will run to confirm
 * it is installed, signed in, within usage limits, and allowed that model.
 */
export async function probeProvider(
  provider: ProbedProvider,
  model: string,
): Promise<ProviderProbe> {
  let command: { file: string; args: string[] };
  try {
    command = await probeCommand(provider, model);
  } catch (error) {
    return {
      ok: false,
      reason: "missing",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  const env = agentEnvironment();
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CLAUDE_CODE_SESSION_ID;
  return await new Promise((resolve) => {
    const child = execFile(
      command.file,
      command.args,
      {
        cwd: tmpdir(),
        env,
        timeout: TIMEOUT_MS,
        maxBuffer: 1_000_000,
      },
      (error, stdout, stderr) => {
        const output = `${stdout}\n${stderr}`.trim();
        if (!error && stdout.trim()) {
          resolve({ ok: true });
          return;
        }
        if (error && "code" in error && error.code === "ENOENT") {
          resolve({ ok: false, reason: "missing", detail: output });
          return;
        }
        if (error?.killed) {
          resolve({
            ok: false,
            reason: "failed",
            detail: "It didn't answer in time.",
          });
          return;
        }
        resolve({
          ok: false,
          reason: classify(output),
          detail: lastLine(output),
        });
      },
    );
    child.stdin?.end();
  });
}

async function probeCommand(provider: ProbedProvider, requested: string) {
  const chosen = requested.toLowerCase() === "auto" ? "" : requested;
  if (chosen && !MODEL_PATTERN.test(chosen))
    throw new Error("That model name isn't valid.");
  if (provider === "codex") {
    const [file, model] = await Promise.all([
      ensureCodexBinary(),
      chosen ? Promise.resolve(chosen) : codexDefaultModel(),
    ]);
    return {
      file,
      args: [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        ...(model ? ["--model", model] : []),
        PROMPT,
      ],
    };
  }
  if (provider === "claude") {
    const file = findClaudeCode();
    if (!file) throw new Error("Claude Code isn't installed on this computer.");
    return {
      file,
      args: [
        "-p",
        PROMPT,
        "--output-format",
        "text",
        ...(chosen ? ["--model", chosen] : []),
      ],
    };
  }
  return {
    file: findOpenCode(),
    args: ["run", ...(chosen ? ["--model", chosen] : []), PROMPT],
  };
}

function classify(output: string): "signed_out" | "usage" | "model" | "failed" {
  const text = output.toLowerCase();
  if (
    /model[^\n]*(not supported|not available|unavailable|not found|does not exist)|unknown model|invalid model/.test(
      text,
    )
  )
    return "model";
  if (
    /usage limit|rate limit|quota|out of (credits|usage)|limit reached|hit your limit|insufficient/.test(
      text,
    )
  )
    return "usage";
  if (
    /not logged in|log ?in|sign ?in|unauthori[sz]ed|authenticat|api key|401/.test(
      text,
    )
  )
    return "signed_out";
  return "failed";
}

function lastLine(output: string) {
  const lines = output.split("\n").filter((line) => line.trim());
  return (lines.at(-1) ?? "").replace(/^\s*error:\s*/iu, "").slice(0, 300);
}
