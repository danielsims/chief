import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { Client } from "eve/client";

import type {
  AgentDeploymentProvider,
  DeploymentProviderInput,
  DeploymentReporter,
} from "./types.js";

function clean(line: string) {
  return stripVTControlCharacters(line).trim();
}

function vercelBinary(runtimeModules: string) {
  const path = join(runtimeModules, "vercel", "dist", "vc.js");
  if (!existsSync(path)) {
    throw new Error("The packaged Vercel CLI is unavailable.");
  }
  return path;
}

export function eveDeploymentEnvironment(
  runtimeModules: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const pnpmCli = join(runtimeModules, "pnpm", "bin", "pnpm.cjs");
  if (!existsSync(pnpmCli)) {
    throw new Error("The packaged pnpm installer is unavailable.");
  }
  const childEnvironment: NodeJS.ProcessEnv = {
    ...environment,
    CI: "1",
    npm_execpath: pnpmCli,
    npm_config_user_agent: "pnpm/10.17.1",
    PATH: [join(runtimeModules, ".bin"), environment.PATH]
      .filter(Boolean)
      .join(delimiter),
  };
  delete childEnvironment.VERCEL_TOKEN;
  return childEnvironment;
}

function deploymentUrl(logs: string[]) {
  return logs
    .flatMap((line) => line.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/gi) ?? [])
    .at(-1);
}

async function run(
  executable: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
    reporter: DeploymentReporter;
    allowFailure?: boolean;
  },
) {
  const lines: string[] = [];
  const child = spawn(executable, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  options.reporter.process(child);
  let stdout = "";
  let stderr = "";
  const collect = (chunk: unknown, error: boolean) => {
    const text = String(chunk);
    if (error) stderr += text;
    else stdout += text;
    for (const line of text.split(/\r?\n/)) {
      const normalized = clean(line);
      if (!normalized) continue;
      lines.push(normalized);
      options.reporter.log(normalized);
    }
  };
  child.stdout?.on("data", (chunk) => collect(chunk, false));
  child.stderr?.on("data", (chunk) => collect(chunk, true));
  if (options.input !== undefined) child.stdin?.end(`${options.input}\n`);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  options.reporter.process(undefined);
  if (options.reporter.canceled()) throw new Error("Deployment canceled.");
  if (code !== 0 && !options.allowFailure) {
    throw new Error(clean(stderr) || `${executable} exited with code ${code}.`);
  }
  return { code, stdout, stderr, lines };
}

async function configureEnvironment(
  input: DeploymentProviderInput,
  reporter: DeploymentReporter,
  vercel: string,
  key: string,
  value: string,
) {
  const scope = input.scope ? ["--scope", input.scope] : [];
  await run(
    vercel,
    [
      "env",
      "add",
      key,
      "production",
      "--force",
      "--yes",
      "--sensitive",
      "--non-interactive",
      ...scope,
    ],
    { cwd: input.workspaceRoot, reporter, input: value },
  );
}

export class VercelDeploymentProvider implements AgentDeploymentProvider {
  readonly target = "vercel" as const;

  async deploy(input: DeploymentProviderInput, reporter: DeploymentReporter) {
    const vercel = vercelBinary(input.runtimeModules);
    let effectiveScope = input.scope;
    let scope = effectiveScope ? ["--scope", effectiveScope] : [];

    reporter.phase("authenticating", "Checking your Vercel account.");
    let identity = await run(
      vercel,
      ["whoami", "--format=json", "--non-interactive", ...scope],
      { cwd: input.workspaceRoot, reporter, allowFailure: true },
    );
    if (identity.code !== 0) {
      reporter.phase(
        "authenticating",
        "Approve the Vercel sign-in in your browser.",
      );
      await run(vercel, ["login", "--non-interactive"], {
        cwd: input.workspaceRoot,
        reporter,
      });
      identity = await run(
        vercel,
        ["whoami", "--format=json", "--non-interactive", ...scope],
        { cwd: input.workspaceRoot, reporter },
      );
    }
    if (!effectiveScope) {
      try {
        const account = JSON.parse(identity.stdout) as {
          username?: string;
          team?: { slug?: string };
        };
        effectiveScope = account.team?.slug ?? account.username;
      } catch {
        // The explicit error from `vercel link` remains useful if CLI output changes.
      }
      scope = effectiveScope ? ["--scope", effectiveScope] : [];
    }
    const scopedInput = { ...input, scope: effectiveScope };

    reporter.phase("linking", "Creating or linking the Vercel project.");
    await run(
      vercel,
      [
        "link",
        "--project",
        input.projectName,
        "--yes",
        "--non-interactive",
        ...scope,
      ],
      { cwd: input.workspaceRoot, reporter },
    );

    reporter.phase("configuring", "Securing the deployed agent routes.");
    const controlPlaneBase =
      input.environment.CHIEF_CONTROL_PLANE_API_BASE_URL?.trim();
    const controlPlaneToken =
      input.environment.CHIEF_CONTROL_PLANE_TOKEN?.trim();
    if (!controlPlaneBase || !controlPlaneToken) {
      throw new Error(
        "Chief control-plane deployment credentials are missing.",
      );
    }
    const remoteEnvironment: Record<string, string> = {
      CHIEF_EVE_ROUTE_PASSWORD: input.routePassword,
      CHIEF_DEPLOYMENT_MODEL: input.model,
      CHIEF_CONTROL_PLANE_API_BASE_URL: controlPlaneBase,
      CHIEF_CONTROL_PLANE_TOKEN: controlPlaneToken,
    };
    for (const key of ["EXECUTOR_MCP_URL", "EXECUTOR_MCP_TOKEN"] as const) {
      const value = input.environment[key]?.trim();
      if (value) remoteEnvironment[key] = value;
    }
    for (const key of input.channelEnvironmentKeys ?? []) {
      const value = input.environment[key]?.trim();
      if (!value) {
        throw new Error(`Add ${key} before deploying the selected channel.`);
      }
      remoteEnvironment[key] = value;
    }
    for (const [key, value] of Object.entries(remoteEnvironment)) {
      await configureEnvironment(scopedInput, reporter, vercel, key, value);
    }

    const childEnvironment = eveDeploymentEnvironment(input.runtimeModules);
    const packagedPnpm = childEnvironment.npm_execpath;
    if (!packagedPnpm) {
      throw new Error("The packaged pnpm installer is unavailable.");
    }
    reporter.phase("building", "Installing deployment dependencies.");
    await run(
      process.execPath,
      [
        packagedPnpm,
        "--dir",
        input.workspaceRoot,
        "install",
        "--no-frozen-lockfile",
      ],
      {
        cwd: input.workspaceRoot,
        reporter,
        env: childEnvironment,
      },
    );
    const installedEve = join(
      input.workspaceRoot,
      "node_modules",
      "eve",
      "bin",
      "eve.js",
    );
    if (!existsSync(installedEve)) {
      throw new Error("The deployment workspace did not install Eve.");
    }
    reporter.phase("building", "Building the Eve agent workspace.");
    const deployed = await run(process.execPath, [installedEve, "deploy"], {
      cwd: input.workspaceRoot,
      reporter,
      env: childEnvironment,
    });
    const url = deploymentUrl(deployed.lines);
    if (!url)
      throw new Error("Vercel completed without returning a deployment URL.");

    reporter.phase("verifying", "Verifying authenticated remote chat access.");
    const client = new Client({
      host: url,
      auth: {
        basic: {
          username: "chief-desktop",
          password: input.routePassword,
        },
      },
      redirect: "error",
    });
    await client.health();
    await client.info();
    return { target: this.target, url, scope: effectiveScope };
  }
}
