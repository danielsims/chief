import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";

import type { SessionManager } from "./manager.js";
import type {
  AgentDeploymentPlaybook,
  AgentDeploymentRecord,
} from "./types.js";
import { materializeEveWorkspace } from "./eve-workspace.js";
import { readWorkspaceContext } from "./workspace-context.js";
import { workspaceKey, workspaceSecrets } from "./workspace-secrets.js";

const MAX_LOG_LINES = 200;
const VERCEL_API = "https://api.vercel.com";

interface StartDeploymentInput {
  workspaceId: string;
  agentId: string;
  projectName: string;
  teamId?: string;
  playbooks: AgentDeploymentPlaybook[];
}

interface VercelProject {
  id: string;
  name: string;
}

function deploymentRoot(workspaceId: string, agentId: string) {
  return join(
    homedir(),
    ".chief",
    "deployments",
    workspaceKey(workspaceId),
    agentId,
  );
}

function templateRoot() {
  const configured = process.env.CHIEF_EVE_WORKSPACE_TEMPLATE;
  if (configured) return resolve(configured);
  const runtime = process.env.CHIEF_RUNTIME_ROOT;
  if (runtime) return join(runtime, "deployment-workspace");
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../apps/workspace",
  );
}

function runtimeModules() {
  const runtime = process.env.CHIEF_RUNTIME_ROOT;
  if (runtime) return join(runtime, "node_modules");
  return join(templateRoot(), "node_modules");
}

function copyTemplate(source: string, target: string) {
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
  symlinkSync(runtimeModules(), join(target, "node_modules"), "junction");
}

function vercelUrl(path: string, teamId?: string) {
  const url = new URL(path, VERCEL_API);
  if (teamId) url.searchParams.set("teamId", teamId);
  return url;
}

async function vercelRequest<T>(
  token: string,
  path: string,
  init: RequestInit = {},
  teamId?: string,
): Promise<T> {
  const response = await fetch(vercelUrl(path, teamId), {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Vercel returned ${response.status}: ${body.slice(0, 300)}`,
    );
  }
  return (await response.json()) as T;
}

async function resolveVercelProject(
  token: string,
  name: string,
  teamId?: string,
) {
  const response = await fetch(
    vercelUrl(`/v9/projects/${encodeURIComponent(name)}`, teamId),
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (response.ok) return (await response.json()) as VercelProject;
  if (response.status !== 404) {
    throw new Error(`Vercel project lookup returned ${response.status}.`);
  }
  return vercelRequest<VercelProject>(
    token,
    "/v10/projects",
    { method: "POST", body: JSON.stringify({ name }) },
    teamId,
  );
}

async function resolveVercelOwner(token: string, teamId?: string) {
  if (teamId) return teamId;
  const user = await vercelRequest<{ user: { id: string } }>(token, "/v2/user");
  return user.user.id;
}

function deploymentUrl(logs: string[]) {
  return logs
    .flatMap((line) => line.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/gi) ?? [])
    .at(-1);
}

export class AgentDeploymentManager {
  private records = new Map<string, AgentDeploymentRecord>();
  private processes = new Map<string, ChildProcess>();

  constructor(
    private manager: SessionManager,
    private onUpdate: (record: AgentDeploymentRecord) => void,
  ) {}

  list(workspaceId: string) {
    return [...this.records.values()]
      .filter((record) => record.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  start(input: StartDeploymentInput) {
    const existing = this.list(input.workspaceId).find(
      (record) =>
        record.agentId === input.agentId && record.status === "running",
    );
    if (existing) return existing;
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(input.projectName)) {
      throw new Error("Use a valid Vercel project name.");
    }
    const now = Date.now();
    const record: AgentDeploymentRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      target: "vercel",
      projectName: input.projectName,
      teamId: input.teamId,
      status: "running",
      phase: "preparing",
      logs: [],
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.id, record);
    this.emit(record);
    void this.run(record.id, input);
    return record;
  }

  cancel(workspaceId: string, deploymentId: string) {
    const record = this.records.get(deploymentId);
    if (record?.workspaceId !== workspaceId) return;
    this.processes.get(deploymentId)?.kill("SIGTERM");
    this.update(deploymentId, {
      status: "canceled",
      phase: undefined,
      detail: "Deployment canceled.",
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
    this.emit(next);
  }

  private log(id: string, line: string) {
    const current = this.records.get(id);
    if (!current || !line.trim()) return;
    this.update(id, {
      logs: [...current.logs, line.trim()].slice(-MAX_LOG_LINES),
    });
  }

  private async run(id: string, input: StartDeploymentInput) {
    try {
      const environment = await workspaceSecrets.materialize(input.workspaceId);
      const token = environment.VERCEL_TOKEN;
      if (!token) {
        this.update(id, {
          status: "needs_configuration",
          phase: undefined,
          detail: "Add VERCEL_TOKEN in Environment before deploying.",
        });
        return;
      }

      const source = templateRoot();
      if (!existsSync(source)) {
        throw new Error("The packaged Eve workspace template is unavailable.");
      }
      const target = deploymentRoot(input.workspaceId, input.agentId);
      copyTemplate(source, target);
      const data = await this.manager.workspaceData(input.workspaceId);
      materializeEveWorkspace(target, {
        agentId: input.agentId,
        context: readWorkspaceContext(input.workspaceId),
        playbooks: input.playbooks,
        automations: data.recurringWork.map((work) => ({
          id: work.id,
          agentId: work.agentId,
          cron: work.cron,
          timezone: work.timezone,
          instructions: work.instructions,
          toolPatterns: work.grant?.toolPatterns ?? [],
          placement: work.placement,
        })),
      });

      const project = await resolveVercelProject(
        token,
        input.projectName,
        input.teamId,
      );
      const ownerId = await resolveVercelOwner(token, input.teamId);
      mkdirSync(join(target, ".vercel"), { recursive: true });
      writeFileSync(
        join(target, ".vercel", "project.json"),
        JSON.stringify({ orgId: ownerId, projectId: project.id }, null, 2),
      );

      this.update(id, { phase: "building", detail: "Building the Eve agent." });
      const eveBin = join(runtimeModules(), "eve", "bin", "eve.js");
      if (!existsSync(eveBin)) {
        throw new Error("The packaged Eve deployment runtime is unavailable.");
      }
      const child = spawn(process.execPath, [eveBin, "deploy"], {
        cwd: target,
        env: { ...process.env, ...environment, CI: "1", VERCEL_TOKEN: token },
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.processes.set(id, child);
      this.update(id, { phase: "deploying", detail: "Deploying to Vercel." });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) =>
        chunk.split("\n").forEach((line) => this.log(id, line)),
      );
      child.stderr.on("data", (chunk: string) =>
        chunk.split("\n").forEach((line) => this.log(id, line)),
      );
      const code = await new Promise<number | null>((resolveCode, reject) => {
        child.once("error", reject);
        child.once("exit", resolveCode);
      });
      this.processes.delete(id);
      if (this.records.get(id)?.status === "canceled") return;
      if (code !== 0)
        throw new Error(`Eve deployment exited with code ${code}.`);

      const url = deploymentUrl(this.records.get(id)?.logs ?? []);
      if (!url) throw new Error("Vercel completed without returning a URL.");
      this.update(id, {
        phase: "verifying",
        detail: "Verifying the live agent.",
      });
      const health = await fetch(new URL("/eve/v1/health", url));
      if (!health.ok)
        throw new Error(`Health check returned ${health.status}.`);
      this.update(id, {
        status: "ready",
        phase: undefined,
        detail: "Agent is live.",
        url,
      });
    } catch (error) {
      this.update(id, {
        status: "failed",
        phase: undefined,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
