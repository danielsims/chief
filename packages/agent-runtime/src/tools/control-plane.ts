import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ExecutorCapability } from "../types.js";
import { executorBinary } from "./spec.js";

const execFileAsync = promisify(execFile);
const CHIEF_INTEGRATION = "chief";
const LOCAL_INTEGRATION = "chief-local";
const CONNECTION_NAME = "workspace";
const LOCAL_CONNECTION_NAME = "localworkspace";

interface ServerManifest {
  connection: {
    apiBaseUrl: string;
    auth:
      | { kind: "bearer"; token: string }
      | { kind: "oauth"; accessToken: string }
      | { kind: "basic"; username?: string; password: string };
  };
}

interface Integration {
  slug: string;
}

interface Connection {
  owner: "org" | "user";
  integration: string;
  name: string;
}

interface Tool {
  address: string;
  name: string;
}

interface Policy {
  id: string;
  owner: "org" | "user";
  pattern: string;
  action: "approve" | "require_approval" | "block";
}

export interface ExecutorWorkspace {
  scopeDir: string;
  dataDir: string;
}

const pending = new Map<string, Promise<ExecutorWorkspace>>();

function workspaceKey(workspaceId: string): string {
  return createHash("sha256").update(workspaceId).digest("hex").slice(0, 24);
}

function capabilityKey(
  workspaceId: string,
  capability: ExecutorCapability,
): string {
  return createHash("sha256")
    .update(workspaceId)
    .update("\0")
    .update(capability.apiBaseUrl)
    .update("\0")
    .update(capability.token)
    .digest("hex");
}

function pathsForWorkspace(workspaceId: string): ExecutorWorkspace {
  const relative = join("executor", "workspaces", workspaceKey(workspaceId));
  const current = join(homedir(), ".chief", relative);
  const legacy = join(homedir(), ".marketer", relative);
  const root = !existsSync(current) && existsSync(legacy) ? legacy : current;
  return { scopeDir: join(root, "scope"), dataDir: join(root, "data") };
}

function portForWorkspace(workspaceId: string): number {
  const key = workspaceKey(workspaceId);
  return 20_000 + (Number.parseInt(key.slice(0, 6), 16) % 20_000);
}

function portIsAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function availableWorkspacePort(workspaceId: string) {
  const first = portForWorkspace(workspaceId);
  for (let offset = 0; offset < 64; offset += 1) {
    const port = 20_000 + ((first - 20_000 + offset) % 20_000);
    if (await portIsAvailable(port)) return port;
  }
  throw new Error("No local port is available for this workspace's tools.");
}

function manifestPath(dataDir: string) {
  return join(dataDir, "server-control", "server.json");
}

async function readManifest(dataDir: string): Promise<ServerManifest | null> {
  try {
    const manifest = JSON.parse(
      await readFile(manifestPath(dataDir), "utf8"),
    ) as ServerManifest;
    return manifest.connection?.apiBaseUrl && manifest.connection.auth
      ? manifest
      : null;
  } catch {
    return null;
  }
}

async function waitForManifest(dataDir: string): Promise<ServerManifest> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const manifest = await readManifest(dataDir);
      if (manifest) return manifest;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Executor daemon did not become ready${lastError instanceof Error ? `: ${lastError.message}` : "."}`,
  );
}

async function request<T>(
  manifest: ServerManifest,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const auth = manifest.connection.auth;
  const authorization =
    auth.kind === "bearer"
      ? `Bearer ${auth.token}`
      : auth.kind === "oauth"
        ? `Bearer ${auth.accessToken}`
        : `Basic ${Buffer.from(`${auth.username ?? "executor"}:${auth.password}`).toString("base64")}`;
  const response = await fetch(`${manifest.connection.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: authorization,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Executor ${init?.method ?? "GET"} ${path} failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

const bearerAuthentication = [
  {
    slug: "workspace",
    type: "apiKey",
    label: "Workspace capability",
    headers: {
      Authorization: ["Bearer ", { type: "variable", name: "token" }],
    },
  },
];

async function configureIntegration(
  manifest: ServerManifest,
  capability: ExecutorCapability,
) {
  const specUrl = `${capability.apiBaseUrl.replace(/\/$/, "")}/agent-tools/openapi.json`;
  const integrations = await request<Integration[]>(manifest, "/integrations");
  const exists = integrations.some(
    (integration) => integration.slug === CHIEF_INTEGRATION,
  );

  if (exists) {
    await request(manifest, `/openapi/integrations/${CHIEF_INTEGRATION}/spec`, {
      method: "POST",
      body: JSON.stringify({ spec: { kind: "url", url: specUrl } }),
    });
    await request(
      manifest,
      `/openapi/integrations/${CHIEF_INTEGRATION}/config`,
      {
        method: "POST",
        body: JSON.stringify({
          mode: "replace",
          authenticationTemplate: bearerAuthentication,
          baseUrl: capability.apiBaseUrl,
        }),
      },
    );
  } else {
    await request(manifest, "/openapi/specs", {
      method: "POST",
      body: JSON.stringify({
        spec: { kind: "url", url: specUrl },
        slug: CHIEF_INTEGRATION,
        name: "Chief",
        description:
          "Connected data and actions for the current Chief workspace.",
        family: "chief",
        baseUrl: capability.apiBaseUrl,
        authenticationTemplate: bearerAuthentication,
      }),
    });
  }
}

async function configureLocalIntegration(
  manifest: ServerManifest,
  capability: ExecutorCapability,
) {
  const specUrl = "http://127.0.0.1:4318/local-tools/openapi.json";
  const baseUrl = "http://127.0.0.1:4318";
  const integrations = await request<Integration[]>(manifest, "/integrations");
  const exists = integrations.some(
    (integration) => integration.slug === LOCAL_INTEGRATION,
  );
  if (exists) {
    await request(manifest, `/openapi/integrations/${LOCAL_INTEGRATION}/spec`, {
      method: "POST",
      body: JSON.stringify({ spec: { kind: "url", url: specUrl } }),
    });
    await request(
      manifest,
      `/openapi/integrations/${LOCAL_INTEGRATION}/config`,
      {
        method: "POST",
        body: JSON.stringify({
          mode: "replace",
          authenticationTemplate: bearerAuthentication,
          baseUrl,
        }),
      },
    );
  } else {
    await request(manifest, "/openapi/specs", {
      method: "POST",
      body: JSON.stringify({
        spec: { kind: "url", url: specUrl },
        slug: LOCAL_INTEGRATION,
        name: "Chief local workspace",
        description: "Private prospects, trends and content on this Mac.",
        family: "chief",
        baseUrl,
        authenticationTemplate: bearerAuthentication,
      }),
    });
  }
}

async function replaceConnection(
  manifest: ServerManifest,
  capability: ExecutorCapability,
  integration = CHIEF_INTEGRATION,
  connectionName = CONNECTION_NAME,
) {
  const connections = await request<Connection[]>(
    manifest,
    `/connections?integration=${integration}&owner=org`,
  );
  if (
    connections.some(
      (connection) =>
        connection.integration === integration &&
        connection.owner === "org" &&
        connection.name === connectionName,
    )
  ) {
    await request(
      manifest,
      `/connections/org/${integration}/${connectionName}`,
      { method: "DELETE" },
    );
  }

  await request(manifest, "/connections", {
    method: "POST",
    body: JSON.stringify({
      owner: "org",
      name: connectionName,
      integration,
      template: "workspace",
      value: capability.token,
      identityLabel: "Current Chief workspace",
    }),
  });
}

async function configureToolPolicies(manifest: ServerManifest) {
  const [cloudTools, localTools] = await Promise.all([
    request<Tool[]>(
      manifest,
      `/tools?integration=${CHIEF_INTEGRATION}&owner=org&connection=${CONNECTION_NAME}&includeAnnotations=true`,
    ),
    request<Tool[]>(
      manifest,
      `/tools?integration=${LOCAL_INTEGRATION}&owner=org&connection=${LOCAL_CONNECTION_NAME}&includeAnnotations=true`,
    ),
  ]);
  const policies = await request<Policy[]>(manifest, "/policies");
  const actions = new Map<string, Policy["action"]>([
    ...[
      "agentTools.sourcesList",
      "agentTools.analyticsRunReport",
      "agentTools.uiPresentChart",
      "localTools.prospectsList",
      "localTools.prospectsSave",
      "localTools.trendsList",
      "localTools.trendsSave",
      "localTools.contentList",
      "localTools.contentSave",
      "localTools.campaignsList",
      "localTools.campaignsSave",
      "localTools.attentionRaise",
      "localTools.brandProfileSave",
      "localTools.recurringWorkList",
      "localTools.recurringWorkPropose",
      "localTools.googleAnalyticsMetadata",
      "localTools.googleAnalyticsProperties",
      "localTools.googleAnalyticsRunReport",
    ].map((name) => [name, "approve"] as const),
  ]);
  const governedTools = [...cloudTools, ...localTools].filter((tool) =>
    actions.has(tool.name),
  );

  for (const tool of governedTools) {
    const pattern = tool.address.replace(/^tools\./, "");
    const action = actions.get(tool.name)!;
    const existing = policies.filter((item) => item.pattern === pattern);
    const keep = existing.find(
      (item) => item.owner === "org" && item.action === action,
    );
    for (const policy of existing) {
      if (policy === keep) continue;
      await request(manifest, `/policies/${encodeURIComponent(policy.id)}`, {
        method: "DELETE",
        body: JSON.stringify({ owner: policy.owner }),
      });
    }
    if (!keep) {
      await request(manifest, "/policies", {
        method: "POST",
        body: JSON.stringify({ owner: "org", pattern, action }),
      });
    }
  }
}

async function provision(
  workspaceId: string,
  capability: ExecutorCapability,
): Promise<ExecutorWorkspace> {
  const workspace = pathsForWorkspace(workspaceId);
  await mkdir(workspace.scopeDir, { recursive: true });
  await mkdir(workspace.dataDir, { recursive: true });
  await writeFile(join(workspace.scopeDir, "executor.jsonc"), "{}\n", {
    flag: "wx",
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });

  let manifest = await readManifest(workspace.dataDir);
  if (manifest) {
    try {
      await request(manifest, "/integrations");
    } catch {
      manifest = null;
      await rm(manifestPath(workspace.dataDir), { force: true });
    }
  }

  if (!manifest) {
    const port = await availableWorkspacePort(workspaceId);
    await execFileAsync(
      executorBinary(),
      [
        "daemon",
        "run",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
        "--scope",
        workspace.scopeDir,
      ],
      {
        env: { ...process.env, EXECUTOR_DATA_DIR: workspace.dataDir },
        timeout: 30_000,
      },
    );
    manifest = await waitForManifest(workspace.dataDir);
  }
  await configureIntegration(manifest, capability);
  await configureLocalIntegration(manifest, capability);
  await replaceConnection(manifest, capability);
  await replaceConnection(
    manifest,
    capability,
    LOCAL_INTEGRATION,
    LOCAL_CONNECTION_NAME,
  );
  await configureToolPolicies(manifest);
  return workspace;
}

/** Returns the isolated on-disk Executor scope for an already-provisioned workspace. */
export function existingExecutorWorkspace(workspaceId: string) {
  return pathsForWorkspace(workspaceId);
}

/** Idempotently prepares one isolated Executor tenant per Chief workspace. */
export function ensureExecutorWorkspace(
  workspaceId: string,
  capability: ExecutorCapability,
): Promise<ExecutorWorkspace> {
  const key = capabilityKey(workspaceId, capability);
  const existing = pending.get(key);
  if (existing) return existing;
  const task = provision(workspaceId, capability).catch((error) => {
    pending.delete(key);
    throw error;
  });
  pending.set(key, task);
  return task;
}
