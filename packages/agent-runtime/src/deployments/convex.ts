import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import type {
  AgentDeploymentProvider,
  DeploymentProviderInput,
  DeploymentReporter,
} from "./types.js";
import { DeploymentNeedsConfigurationError } from "./types.js";

function convexCli(runtimeModules: string) {
  const path = join(runtimeModules, "convex", "bin", "main.js");
  if (!existsSync(path)) {
    throw new Error("The packaged Convex CLI is unavailable.");
  }
  return path;
}

function scrub(text: string, secrets: string[]) {
  return stripVTControlCharacters(
    secrets
      .filter(Boolean)
      .reduce((line, secret) => line.replaceAll(secret, "[redacted]"), text),
  ).trim();
}

async function run(
  cli: string,
  args: string[],
  options: {
    cwd: string;
    reporter: DeploymentReporter;
    input?: string;
    allowFailure?: boolean;
    quiet?: boolean;
    secrets?: string[];
  },
) {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: options.cwd,
    env: process.env,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  options.reporter.process(child);
  let stdout = "";
  let stderr = "";
  const collect = (chunk: unknown, isError: boolean) => {
    const text = String(chunk);
    if (isError) stderr += text;
    else stdout += text;
    for (const raw of text.split(/\r?\n/)) {
      const line = scrub(raw, options.secrets ?? []);
      if (line && !options.quiet) options.reporter.log(line);
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
    const failure = scrub(stderr, options.secrets ?? []);
    throw new Error(failure ? failure : `Convex CLI exited with code ${code}.`);
  }
  return { code, stdout, stderr };
}

function configuredDeployment(root: string) {
  try {
    const source = readFileSync(join(root, ".env.local"), "utf8");
    const deployment = /^CONVEX_DEPLOYMENT=(.+)$/m.exec(source);
    const url = /^CONVEX_URL=(.+)$/m.exec(source);
    return {
      deployment: deployment?.[1]?.trim(),
      url: url?.[1]?.trim(),
    };
  } catch {
    return {};
  }
}

function deploymentSiteUrl(raw: string | undefined) {
  if (!raw) throw new Error("Convex did not write a deployment URL.");
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.hostname.endsWith(".convex.cloud")
  ) {
    throw new Error("Convex returned an invalid cloud deployment URL.");
  }
  url.hostname = `${url.hostname.slice(0, -".convex.cloud".length)}.convex.site`;
  url.pathname = "";
  return url.origin;
}

function previousProject(root: string) {
  try {
    return JSON.parse(
      readFileSync(join(root, ".chief-convex.json"), "utf8"),
    ) as {
      projectName?: string;
      scope?: string;
    };
  } catch {
    return undefined;
  }
}

export function convexTeamSlugs(output: string) {
  return [...output.matchAll(/^\s*-\s+.+\(([^()]+)\)\s*$/gm)].flatMap(
    (match) => (match[1] ? [match[1]] : []),
  );
}

async function setEnvironment(
  cli: string,
  input: DeploymentProviderInput,
  reporter: DeploymentReporter,
  key: string,
  value: string,
  secrets: string[],
) {
  await run(cli, ["env", "set", key], {
    cwd: input.workspaceRoot,
    reporter,
    input: value,
    quiet: true,
    secrets,
  });
}

export class ConvexDeploymentProvider implements AgentDeploymentProvider {
  readonly target = "convex" as const;

  async deploy(input: DeploymentProviderInput, reporter: DeploymentReporter) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.projectName)) {
      throw new Error(
        "Convex project names may contain lowercase letters, numbers, and hyphens.",
      );
    }
    const gatewayKey = input.environment.AI_GATEWAY_API_KEY?.trim();
    if (!gatewayKey) {
      throw new DeploymentNeedsConfigurationError(
        "Add AI_GATEWAY_API_KEY to this workspace before deploying Convex.",
      );
    }
    const controlPlaneBase =
      input.environment.CHIEF_CONTROL_PLANE_API_BASE_URL?.trim();
    const controlPlaneToken =
      input.environment.CHIEF_CONTROL_PLANE_TOKEN?.trim();
    if (!controlPlaneBase || !controlPlaneToken) {
      throw new Error(
        "Chief control-plane deployment credentials are missing.",
      );
    }
    const controlUrl = new URL(controlPlaneBase);
    if (
      controlUrl.protocol !== "https:" ||
      controlUrl.username ||
      controlUrl.password
    ) {
      throw new Error("Chief control-plane deployment URL must use HTTPS.");
    }

    const cli = convexCli(input.runtimeModules);
    const secrets = [gatewayKey, controlPlaneToken, input.routePassword];
    reporter.phase("authenticating", "Checking your Convex CLI login.");
    let identity = await run(cli, ["login", "status"], {
      cwd: input.workspaceRoot,
      reporter,
      allowFailure: true,
      secrets,
    });
    if (identity.code !== 0) {
      reporter.phase(
        "authenticating",
        "Approve the Convex sign-in in your browser.",
      );
      await run(
        cli,
        ["login", "--device-name", "Chief", "--login-flow", "poll"],
        {
          cwd: input.workspaceRoot,
          reporter,
          secrets,
        },
      );
      identity = await run(cli, ["login", "status"], {
        cwd: input.workspaceRoot,
        reporter,
        secrets,
      });
    }
    const teams = convexTeamSlugs(`${identity.stdout}\n${identity.stderr}`);
    const scope =
      input.scope?.trim() ?? (teams.length === 1 ? teams[0] : undefined);
    if (!scope) {
      throw new DeploymentNeedsConfigurationError(
        "Enter a Convex team slug because this login can access multiple teams.",
      );
    }

    const prior = previousProject(input.workspaceRoot);
    const configured = configuredDeployment(input.workspaceRoot);
    const canReuse =
      Boolean(configured.deployment && configured.url) &&
      prior?.projectName === input.projectName &&
      prior.scope === scope;
    reporter.phase(
      "linking",
      canReuse
        ? "Reusing the linked Convex project."
        : "Creating or linking the Convex project.",
    );
    const configure = canReuse
      ? []
      : [
          "--configure",
          "new",
          "--team",
          scope,
          "--project",
          input.projectName,
          "--dev-deployment",
          "cloud",
        ];
    reporter.phase("deploying", "Deploying the Convex agent functions.");
    await run(
      cli,
      [
        "dev",
        "--once",
        "--typecheck",
        "enable",
        "--tail-logs",
        "always",
        ...configure,
      ],
      { cwd: input.workspaceRoot, reporter, secrets },
    );

    const deployment = configuredDeployment(input.workspaceRoot);
    const url = deploymentSiteUrl(deployment.url);
    writeFileSync(
      join(input.workspaceRoot, ".chief-convex.json"),
      `${JSON.stringify({ projectName: input.projectName, scope })}\n`,
      { mode: 0o600 },
    );
    reporter.phase(
      "configuring",
      "Setting encrypted Convex deployment environment.",
    );
    const remoteEnvironment: Record<string, string> = {
      AI_GATEWAY_API_KEY: gatewayKey,
      CHIEF_ROUTE_PASSWORD: input.routePassword,
      CHIEF_CONTROL_PLANE_API_BASE_URL: controlUrl
        .toString()
        .replace(/\/$/, ""),
      CHIEF_CONTROL_PLANE_TOKEN: controlPlaneToken,
      CHIEF_DEPLOYMENT_MODEL: input.model,
    };
    for (const [key, value] of Object.entries(remoteEnvironment)) {
      await setEnvironment(cli, input, reporter, key, value, secrets);
    }

    reporter.phase(
      "verifying",
      "Verifying authenticated Convex session access.",
    );
    const authorization = Buffer.from(
      `chief-desktop:${input.routePassword}`,
    ).toString("base64");
    const health = await fetch(`${url}/v1/health`, {
      headers: { authorization: `Basic ${authorization}` },
      redirect: "error",
    });
    if (!health.ok) {
      throw new Error(
        `Convex session API verification failed with HTTP ${health.status}.`,
      );
    }
    const body = (await health.json()) as {
      ok?: boolean;
      configured?: boolean;
    };
    if (!body.ok || !body.configured) {
      throw new Error(
        "Convex session API is live but AI Gateway is not configured.",
      );
    }
    return {
      target: this.target,
      url,
      projectId: deployment.deployment,
      scope,
    };
  }
}
