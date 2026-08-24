import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

import type { ExecRequest, ExecResult } from "@chief/relay-contracts";

interface RunOptions {
  cwd: string;
  maxOutputBytes: number;
}

export async function runProcess(
  input: ExecRequest,
  options: RunOptions,
): Promise<ExecResult> {
  const startedAt = performance.now();
  const [command, ...arguments_] = input.argv;
  if (!command) throw new Error("An executable is required.");
  const child = spawn(command, arguments_, {
    cwd: options.cwd,
    shell: false,
    env: safeEnvironment(options.cwd),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output = createOutputCollector(options.maxOutputBytes);
  child.stdout.on("data", (chunk: Buffer) => output.appendStdout(chunk));
  child.stderr.on("data", (chunk: Buffer) => output.appendStderr(chunk));
  if (input.stdin) child.stdin.end(input.stdin);
  else child.stdin.end();

  const timeout = setTimeout(() => child.kill("SIGKILL"), input.timeoutMillis);
  const result = await new Promise<{
    code: number | null;
    signal: string | null;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(timeout));

  return {
    exitCode: result.code,
    signal: result.signal,
    stdout: output.stdout(),
    stderr: output.stderr(),
    truncated: output.truncated(),
    durationMillis: Math.round(performance.now() - startedAt),
  };
}

function safeEnvironment(workspaceRoot: string): NodeJS.ProcessEnv {
  return {
    HOME: workspaceRoot,
    LANG: "C.UTF-8",
    PATH: "/usr/local/bin:/usr/bin:/bin",
    TMPDIR: "/tmp",
  };
}

function createOutputCollector(maxBytes: number) {
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let wasTruncated = false;
  const append = (current: Buffer, chunk: Buffer) => {
    const remaining = Math.max(0, maxBytes - stdout.length - stderr.length);
    if (chunk.length > remaining) wasTruncated = true;
    return Buffer.concat([current, chunk.subarray(0, remaining)]);
  };
  return {
    appendStdout(chunk: Buffer) {
      stdout = append(stdout, chunk);
    },
    appendStderr(chunk: Buffer) {
      stderr = append(stderr, chunk);
    },
    stdout: () => stdout.toString("utf8"),
    stderr: () => stderr.toString("utf8"),
    truncated: () => wasTruncated,
  };
}
