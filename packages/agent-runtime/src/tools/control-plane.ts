import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ExecutorCapability } from "../types.js";
import { executorBinary } from "./spec.js";

const execFileAsync = promisify(execFile);
const MARKETER_INTEGRATION = "marketer";
const CONNECTION_NAME = "workspace";

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
  const root = join(
    homedir(),
    ".marketer",
    "executor",
    "workspaces",
    workspaceKey(workspaceId),
  );
  return { scopeDir: join(root, "scope"), dataDir: join(root, "data") };
}

async function waitForManifest(dataDir: string): Promise<ServerManifest> {
  const path = join(dataDir, "server-control", "server.json");
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const manifest = JSON.parse(
        await readFile(path, "utf8"),
      ) as ServerManifest;
      if (manifest.connection?.apiBaseUrl && manifest.connection.auth) {
        return manifest;
      }
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
    (integration) => integration.slug === MARKETER_INTEGRATION,
  );

  if (exists) {
    await request(
      manifest,
      `/openapi/integrations/${MARKETER_INTEGRATION}/spec`,
      {
        method: "POST",
        body: JSON.stringify({ spec: { kind: "url", url: specUrl } }),
      },
    );
    await request(
      manifest,
      `/openapi/integrations/${MARKETER_INTEGRATION}/config`,
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
        slug: MARKETER_INTEGRATION,
        name: "Marketer",
        description:
          "Connected data and actions for the current Marketer workspace.",
        family: "marketer",
        baseUrl: capability.apiBaseUrl,
        authenticationTemplate: bearerAuthentication,
      }),
    });
  }
}

async function replaceConnection(
  manifest: ServerManifest,
  capability: ExecutorCapability,
) {
  const connections = await request<Connection[]>(
    manifest,
    `/connections?integration=${MARKETER_INTEGRATION}&owner=org`,
  );
  if (
    connections.some(
      (connection) =>
        connection.integration === MARKETER_INTEGRATION &&
        connection.owner === "org" &&
        connection.name === CONNECTION_NAME,
    )
  ) {
    await request(
      manifest,
      `/connections/org/${MARKETER_INTEGRATION}/${CONNECTION_NAME}`,
      { method: "DELETE" },
    );
  }

  await request(manifest, "/connections", {
    method: "POST",
    body: JSON.stringify({
      owner: "org",
      name: CONNECTION_NAME,
      integration: MARKETER_INTEGRATION,
      template: "workspace",
      value: capability.token,
      identityLabel: "Current Marketer workspace",
    }),
  });
}

async function approveReadTools(manifest: ServerManifest) {
  const tools = await request<Tool[]>(
    manifest,
    `/tools?integration=${MARKETER_INTEGRATION}&owner=org&connection=${CONNECTION_NAME}&includeAnnotations=true`,
  );
  const policies = await request<Policy[]>(manifest, "/policies");
  const readTools = tools.filter((tool) =>
    ["agentTools.sourcesList", "agentTools.analyticsRunReport"].includes(
      tool.name,
    ),
  );

  for (const tool of readTools) {
    const pattern = tool.address.replace(/^tools\./, "");
    if (
      policies.some(
        (policy) => policy.pattern === pattern && policy.action === "approve",
      )
    ) {
      continue;
    }
    await request(manifest, "/policies", {
      method: "POST",
      body: JSON.stringify({ owner: "org", pattern, action: "approve" }),
    });
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

  await execFileAsync(
    executorBinary(),
    ["daemon", "run", "--scope", workspace.scopeDir],
    {
      env: { ...process.env, EXECUTOR_DATA_DIR: workspace.dataDir },
      timeout: 30_000,
    },
  );
  const manifest = await waitForManifest(workspace.dataDir);
  await configureIntegration(manifest, capability);
  await replaceConnection(manifest, capability);
  await approveReadTools(manifest);
  return workspace;
}

/** Idempotently prepares one isolated Executor tenant per Marketer workspace. */
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
