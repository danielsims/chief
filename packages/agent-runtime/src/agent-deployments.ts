import { randomBytes, randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";

import type {
  AgentDeploymentProvider,
  DeploymentReporter,
} from "./deployments/types.js";
import type { SessionManager } from "./manager.js";
import type {
  AgentDeploymentChannel,
  AgentDeploymentPlaybook,
  AgentDeploymentRecord,
  AgentDeploymentTarget,
} from "./types.js";
import {
  persistAgentDeploymentRecord,
  readAgentDeploymentRecord,
} from "./agent-deployment-records.js";
import { defaultAgents, getAgent } from "./agents.js";
import { materializeConvexWorkspace } from "./convex-workspace.js";
import { ConvexDeploymentProvider } from "./deployments/convex.js";
import { DeploymentNeedsConfigurationError } from "./deployments/types.js";
import { VercelDeploymentProvider } from "./deployments/vercel.js";
import { materializeEveWorkspace } from "./eve-workspace.js";
import { agentEnvironmentKey } from "./remote-agent-environment.js";
import { readWorkspaceContext } from "./workspace-context.js";
import { workspaceKey, workspaceSecrets } from "./workspace-secrets.js";

const MAX_LOG_LINES = 300;
const DEFAULT_DEPLOYMENT_MODEL = "xai/grok-4.3";

function nonEmpty(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed?.length ? trimmed : undefined;
}

export function deploymentModel(
  requested: string | undefined,
  environment: Record<string, string>,
) {
  const model =
    nonEmpty(requested) ??
    nonEmpty(environment.CHIEF_DEPLOYMENT_MODEL) ??
    DEFAULT_DEPLOYMENT_MODEL;
  if (model.length > 200) throw new Error("Deployment model is too long.");
  return model;
}

interface StartDeploymentInput {
  workspaceId: string;
  agentId: string;
  target: AgentDeploymentTarget;
  projectName: string;
  teamId?: string;
  model?: string;
  playbooks: AgentDeploymentPlaybook[];
  channels?: AgentDeploymentChannel[];
  activate?: boolean;
  controlPlane: { apiBaseUrl: string; token: string };
}

export function hostedExecutorEnvironment(environment: Record<string, string>) {
  const rawUrl = environment.EXECUTOR_MCP_URL?.trim();
  const token = environment.EXECUTOR_MCP_TOKEN?.trim();
  if (!rawUrl || !token) {
    throw new Error(
      "Add hosted EXECUTOR_MCP_URL and EXECUTOR_MCP_TOKEN values before using a hosted Executor.",
    );
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("EXECUTOR_MCP_URL must be a valid hosted HTTPS URL.");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    isIP(hostname) !== 0 ||
    !hostname.includes(".") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".invalid")
  ) {
    throw new Error(
      "EXECUTOR_MCP_URL must use a real hosted HTTPS endpoint; localhost and non-routable hosts cannot serve a cloud deployment.",
    );
  }
  return { executorMcpToken: token, executorMcpUrl: url.toString() };
}

function deploymentRoot(
  workspaceId: string,
  agentId: string,
  target: AgentDeploymentTarget,
) {
  return join(
    homedir(),
    ".chief",
    "deployments",
    workspaceKey(workspaceId),
    workspaceKey(agentId),
    target,
  );
}

function templateRoot(target: AgentDeploymentTarget) {
  const configured =
    target === "convex"
      ? process.env.CHIEF_CONVEX_WORKSPACE_TEMPLATE
      : process.env.CHIEF_EVE_WORKSPACE_TEMPLATE;
  if (configured) return resolve(configured);
  const runtime = process.env.CHIEF_RUNTIME_ROOT;
  if (runtime) {
    return join(
      runtime,
      target === "convex"
        ? "convex-deployment-workspace"
        : "deployment-workspace",
    );
  }
  if (target === "convex") {
    return resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../templates/convex",
    );
  }
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../apps/workspace",
  );
}

function runtimeModules() {
  const runtime = process.env.CHIEF_RUNTIME_ROOT;
  if (runtime) return join(runtime, "node_modules");
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../apps/workspace/node_modules",
  );
}

function copyTemplate(
  source: string,
  target: string,
  preserveIdentity: boolean,
  linkRuntimeDependencies: boolean,
) {
  const preserved = preserveIdentity
    ? [".env.local", ".chief-convex.json"].flatMap((name) => {
        try {
          return [{ name, value: readFileSync(join(target, name), "utf8") }];
        } catch {
          return [];
        }
      })
    : [];
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const excluded = new Set([
    ".cache",
    ".env.local",
    ".eve",
    ".output",
    ".turbo",
    ".vercel",
    "node_modules",
    "workspace-input",
  ]);
  cpSync(source, target, {
    recursive: true,
    filter: (path) => path === source || !excluded.has(basename(path)),
  });
  if (linkRuntimeDependencies) {
    symlinkSync(runtimeModules(), join(target, "node_modules"), "junction");
  }
  for (const { name, value } of preserved) {
    writeFileSync(join(target, name), value, { mode: 0o600 });
  }
}

export class AgentDeploymentManager {
  private records = new Map<string, AgentDeploymentRecord>();
  private processes = new Map<string, ChildProcess>();
  private canceled = new Set<string>();
  private providers = new Map<AgentDeploymentTarget, AgentDeploymentProvider>([
    ["vercel", new VercelDeploymentProvider()],
    ["convex", new ConvexDeploymentProvider()],
  ]);

  constructor(
    private manager: SessionManager,
    private onUpdate: (record: AgentDeploymentRecord) => void,
  ) {}

  list(workspaceId: string) {
    for (const agent of defaultAgents) {
      const persisted = readAgentDeploymentRecord(workspaceId, agent.id);
      if (persisted && !this.records.has(persisted.id)) {
        this.records.set(persisted.id, persisted);
      }
    }
    return [...this.records.values()]
      .filter((record) => record.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  start(input: StartDeploymentInput) {
    const agent = getAgent(input.agentId);
    if (!agent) throw new Error("Agent is not installed in this workspace.");
    const existing = this.list(input.workspaceId).find(
      (record) =>
        record.agentId === input.agentId && record.status === "running",
    );
    if (existing) return existing;
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(input.projectName)) {
      throw new Error("Use a valid deployment project name.");
    }
    const provider = this.providers.get(input.target);
    if (!provider) {
      throw new Error(`${input.target} deployment is not installed.`);
    }
    const now = Date.now();
    const record: AgentDeploymentRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      target: input.target,
      projectName: input.projectName,
      teamId: input.teamId,
      model: nonEmpty(input.model),
      channels: input.channels,
      activated: input.activate === true,
      status: "running",
      phase: "preparing",
      detail: `Preparing ${input.target}.`,
      logs: [],
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.id, record);
    this.emit(record);
    void this.run(record.id, input, provider);
    return record;
  }

  cancel(workspaceId: string, deploymentId: string) {
    const record = this.records.get(deploymentId);
    if (record?.workspaceId !== workspaceId || record.status !== "running") {
      return;
    }
    this.canceled.add(deploymentId);
    this.processes.get(deploymentId)?.kill("SIGTERM");
    this.update(deploymentId, {
      detail: "Canceling deployment...",
    });
  }

  private emit(record: AgentDeploymentRecord) {
    this.onUpdate({ ...record, logs: [...record.logs] });
  }

  private update(id: string, patch: Partial<AgentDeploymentRecord>) {
    const current = this.records.get(id);
    if (!current) return;
    const next = { ...current, ...patch, updatedAt: Date.now() };
    this.records.set(id, next);
    persistAgentDeploymentRecord(next);
    this.emit(next);
  }

  private log(id: string, line: string) {
    const current = this.records.get(id);
    if (!current || !line.trim()) return;
    this.update(id, {
      logs: [...current.logs, line.trim()].slice(-MAX_LOG_LINES),
    });
  }

  private reporter(id: string): DeploymentReporter {
    return {
      phase: (phase, detail) => this.update(id, { phase, detail }),
      log: (line) => this.log(id, line),
      process: (child) => {
        if (child) this.processes.set(id, child);
        else this.processes.delete(id);
      },
      canceled: () => this.canceled.has(id),
    };
  }

  private async run(
    id: string,
    input: StartDeploymentInput,
    provider: AgentDeploymentProvider,
  ) {
    try {
      const agent = getAgent(input.agentId);
      if (!agent) throw new Error("Agent is not installed in this workspace.");
      const source = templateRoot(input.target);
      if (!existsSync(source)) {
        throw new Error(
          `The packaged ${input.target} workspace template is unavailable.`,
        );
      }
      this.reporter(id).phase(
        "preparing",
        `Preparing an isolated ${input.target} workspace.`,
      );
      if (this.canceled.has(id)) throw new Error("Deployment canceled.");
      const environment = await workspaceSecrets.materialize(input.workspaceId);
      const model = deploymentModel(input.model, environment);
      this.update(id, { model });
      const data = await this.manager.workspaceData(input.workspaceId);
      const target = deploymentRoot(
        input.workspaceId,
        input.agentId,
        input.target,
      );
      copyTemplate(
        source,
        target,
        input.target === "convex",
        input.target === "convex",
      );
      if (this.canceled.has(id)) throw new Error("Deployment canceled.");
      const hasAnyHostedExecutorValue = [
        environment.EXECUTOR_MCP_URL,
        environment.EXECUTOR_MCP_TOKEN,
      ].some((value) => Boolean(value?.trim()));
      const hostedExecutor =
        hasAnyHostedExecutorValue && input.target === "vercel"
          ? hostedExecutorEnvironment(environment)
          : undefined;
      const workspaceInput = {
        agentId: input.agentId,
        context: readWorkspaceContext(input.workspaceId),
        playbooks: input.playbooks,
        hostedExecutor: Boolean(hostedExecutor),
        controlPlane: true,
        automations: data.recurringWork.map((work) => ({
          id: work.id,
          agentId: work.agentId,
          cron: work.cron,
          timezone: work.timezone,
          instructions: work.instructions,
          grant: work.grant,
          placement: work.placement,
          onceAt: work.onceAt,
          status: work.status,
        })),
        channels: input.channels,
      };
      if (input.target === "convex") {
        materializeConvexWorkspace(target, workspaceInput);
      } else {
        materializeEveWorkspace(target, workspaceInput);
      }

      const routePasswordKey = agentEnvironmentKey(
        "CHIEF_EVE_ROUTE_PASSWORD",
        input.agentId,
      );
      const routePassword =
        nonEmpty(environment[routePasswordKey]) ??
        (input.agentId === "cmo"
          ? nonEmpty(environment.CHIEF_EVE_ROUTE_PASSWORD)
          : undefined) ??
        randomBytes(32).toString("base64url");
      if (!environment[routePasswordKey]) {
        await workspaceSecrets.storeEnv(
          input.workspaceId,
          routePasswordKey,
          routePassword,
        );
      }
      const result = await provider.deploy(
        {
          workspaceId: input.workspaceId,
          projectName: input.projectName,
          scope: input.teamId,
          workspaceRoot: target,
          runtimeModules: runtimeModules(),
          routePassword,
          model,
          environment: {
            ...environment,
            CHIEF_CONTROL_PLANE_API_BASE_URL:
              input.controlPlane.apiBaseUrl.replace(/\/$/, ""),
            CHIEF_CONTROL_PLANE_TOKEN: input.controlPlane.token,
          },
          channelEnvironmentKeys:
            input.channels && input.channels.length > 0
              ? ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"]
              : [],
        },
        this.reporter(id),
      );
      if (this.canceled.has(id)) throw new Error("Deployment canceled.");
      await Promise.all([
        workspaceSecrets.storeEnv(
          input.workspaceId,
          agentEnvironmentKey("CHIEF_REMOTE_AGENT_URL", input.agentId),
          result.url,
        ),
        workspaceSecrets.storeEnv(
          input.workspaceId,
          agentEnvironmentKey("CHIEF_REMOTE_AGENT_TARGET", input.agentId),
          result.target,
        ),
      ]);
      if (input.activate) {
        const preference = await this.manager.agentPreference(
          input.workspaceId,
          input.agentId,
        );
        await this.manager.saveAgentPreference(input.workspaceId, {
          ...preference,
          agentId: input.agentId,
          enabled: true,
          driver: "remote",
          model: undefined,
        });
      }
      this.update(id, {
        status: "ready",
        phase: undefined,
        detail: input.activate
          ? `${agent.name} is live and connected to this workspace.`
          : `${agent.name} is live. Its local agent app remains unchanged.`,
        url: result.url,
        projectId: result.projectId,
        teamId: result.scope ?? input.teamId,
      });
    } catch (error) {
      if (this.canceled.has(id)) {
        this.update(id, {
          status: "canceled",
          phase: undefined,
          detail: "Deployment canceled.",
        });
        return;
      }
      this.update(id, {
        status:
          error instanceof DeploymentNeedsConfigurationError
            ? "needs_configuration"
            : "failed",
        phase: undefined,
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.processes.delete(id);
      this.canceled.delete(id);
    }
  }
}
