import { execFile } from "node:child_process";
import { tmpdir } from "node:os";

import { findClaudeCode } from "./drivers/claude-code-path.js";
import { ensureCodexBinary } from "./drivers/codex-install.js";
import { agentEnvironment } from "./drivers/environment.js";
import { findOpenCode } from "./drivers/opencode-support.js";

export type ProbedProvider = "codex" | "claude" | "opencode";

export type ProviderProbe =
  | { ok: true }
  | {
      ok: false;
      reason: "missing" | "signed_out" | "usage" | "failed";
      detail: string;
    };

const PROMPT = "Reply with the single word OK.";
const TIMEOUT_MS = 45_000;

/**
 * Sends the agent app one tiny message and checks it answers, so setup knows
 * Chief can actually run here: installed, signed in and not out of usage.
 */
export async function probeProvider(
  provider: ProbedProvider,
): Promise<ProviderProbe> {
  let command: { file: string; args: string[] };
  try {
    command = await probeCommand(provider);
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

async function probeCommand(provider: ProbedProvider) {
  if (provider === "codex")
    return {
      file: await ensureCodexBinary(),
      args: [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        PROMPT,
      ],
    };
  if (provider === "claude") {
    const file = findClaudeCode();
    if (!file) throw new Error("Claude Code isn't installed on this computer.");
    return { file, args: ["-p", PROMPT, "--output-format", "text"] };
  }
  return { file: findOpenCode(), args: ["run", PROMPT] };
}

function classify(output: string): "signed_out" | "usage" | "failed" {
  const text = output.toLowerCase();
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
  return (lines.at(-1) ?? "").slice(0, 300);
}
