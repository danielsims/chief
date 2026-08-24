/* eslint-disable max-lines */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { isJsonObject, isJsonString } from "@chief/relay-contracts";

import type { PreparedIntegrationSetup } from "../integration-setup-recipes.js";
import type { AgentToolPermission, ExecutorCapability } from "../types.js";
import {
  executorPermissionPolicyAction,
  permissionForExecutorTool,
} from "../agent-tool-permissions.js";
import {
  configureBrowserCredentialIntegration,
  configureIntegrationSetupPolicies,
  configureReadOnlyConnectionPolicies,
  policyMatches,
  storeBrowserGeneratedCredential,
} from "../integration-setup-control.js";
import { browserCredentialSetupRecipe } from "../integration-setup-recipes.js";
import { executorStructuredResult } from "./executor-response.js";
import {
  GOOGLE_ANALYTICS_AUTH_TEMPLATE,
  GOOGLE_ANALYTICS_CONNECTION,
  GOOGLE_ANALYTICS_INTEGRATION,
  GOOGLE_ANALYTICS_OAUTH_CLIENT,
  GOOGLE_ANALYTICS_OPENAPI_URL,
  googleAnalyticsAuthentication,
  prepareGoogleAnalyticsSpec,
} from "./google-analytics-spec.js";
import { executorBinary } from "./spec.js";

export { executorStructuredResult } from "./executor-response.js";

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
  identityLabel?: string | null;
  lastHealth?: { status?: string } | null;
}

interface OAuthClient {
  owner: "org" | "user";
  slug: string;
}

interface OAuthStart {
  status: "connected" | "redirect";
  authorizationUrl?: string;
  state?: string;
}

interface OAuthResult {
  ok: boolean;
  error?: string;
  errorDetails?: string;
}

interface Tool {
  address: string;
  name: string;
  description?: string | null;
  requiresApproval?: boolean | null;
}

interface ToolSchemaView {
  inputSchema?: {
    properties?: Record<string, { $ref?: string }>;
    required?: string[];
  };
}

interface ExecutionResponse {
  status: "completed" | "paused";
  text: string;
  structured: unknown;
  isError?: boolean;
}

export interface GoogleAnalyticsProperty {
  accountName: string;
  propertyId: string;
  propertyName: string;
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
  keychainServiceName: string;
}

const pending = new Map<string, Promise<ExecutorWorkspace>>();
const localWorkspaceCapabilities = new Map<string, ExecutorCapability>();
const localWorkspacePermissionCeilings = new Map<
  string,
  ReadonlySet<AgentToolPermission>
>();
const permissionCeilingSyncs = new Map<string, Promise<void>>();

export function registerLocalWorkspaceCapability(
  workspaceId: string,
  capability: ExecutorCapability,
) {
  localWorkspaceCapabilities.set(workspaceId, capability);
}

export function registerExecutorAgentPermissionCeiling(
  workspaceId: string,
  permissions: readonly AgentToolPermission[],
) {
  localWorkspacePermissionCeilings.set(workspaceId, new Set(permissions));
}
const preparedGoogleAnalytics = new Set<string>();

export {
  googleAnalyticsSpecOverrides,
  prepareGoogleAnalyticsSpec,
} from "./google-analytics-spec.js";

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
  const key = workspaceKey(workspaceId);
  const relative = join("executor", "workspaces", key);
  const current = join(homedir(), ".chief", relative);
  const legacy = join(homedir(), ".marketer", relative);
  const root = !existsSync(current) && existsSync(legacy) ? legacy : current;
  return {
    scopeDir: join(root, "scope"),
    dataDir: join(root, "data"),
    keychainServiceName: `chief-executor-${key}`,
  };
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

function keychainMarkerPath(dataDir: string) {
  return join(dataDir, "server-control", "keychain-service-name");
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
    `Local connection service did not become ready${lastError instanceof Error ? `: ${lastError.message}` : "."}`,
  );
}

export async function request<T>(
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
      ...(init?.body ? { "Content-Type": "application/json" } : undefined),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Local connection ${init?.method ?? "GET"} ${path} failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }
  return (text ? JSON.parse(text) : undefined) as T;
}
export { readManifest };
function executorToolData(value: unknown): unknown {
  if (!value || !isJsonObject(value)) return value;
  const envelope = value as { ok?: unknown; data?: unknown; error?: unknown };
  if (envelope.ok === false) {
    throw new Error(
      isJsonString(envelope.error)
        ? envelope.error
        : JSON.stringify(envelope.error ?? "Local connection tool failed."),
    );
  }
  return envelope.ok === true ? envelope.data : value;
}

function toolInvocationCode(tool: Tool, args: Record<string, unknown>) {
  const segments = tool.address.replace(/^tools\./, "").split(".");
  const access = segments
    .map((segment) => `[${JSON.stringify(segment)}]`)
    .join("");
  return `return await tools${access}(${JSON.stringify(args)});`;
}

async function executeTool(
  manifest: ServerManifest,
  tool: Tool,
  args: Record<string, unknown>,
) {
  const response = await request<ExecutionResponse>(manifest, "/executions", {
    method: "POST",
    body: JSON.stringify({
      code: toolInvocationCode(tool, args),
      autoApprove: true,
    }),
  });
  return executorToolData(executorStructuredResult(response));
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

async function configureGoogleAnalyticsIntegration(manifest: ServerManifest) {
  const preparationKey = manifest.connection.apiBaseUrl;
  if (preparedGoogleAnalytics.has(preparationKey)) return;
  const integrations = await request<Integration[]>(manifest, "/integrations");
  const specResponse = await fetch(GOOGLE_ANALYTICS_OPENAPI_URL, {
    headers: { Accept: "application/json" },
  });
  if (!specResponse.ok) {
    throw new Error(
      `Google Analytics specification returned ${specResponse.status}.`,
    );
  }
  const spec = {
    kind: "blob",
    value: JSON.stringify(
      prepareGoogleAnalyticsSpec(await specResponse.json()),
    ),
  };
  if (
    integrations.some(
      (integration) => integration.slug === GOOGLE_ANALYTICS_INTEGRATION,
    )
  ) {
    await request(
      manifest,
      `/openapi/integrations/${GOOGLE_ANALYTICS_INTEGRATION}/spec`,
      {
        method: "POST",
        body: JSON.stringify({ spec }),
      },
    );
    await request(
      manifest,
      `/openapi/integrations/${GOOGLE_ANALYTICS_INTEGRATION}/config`,
      {
        method: "POST",
        body: JSON.stringify({
          mode: "replace",
          authenticationTemplate: googleAnalyticsAuthentication,
        }),
      },
    );
    preparedGoogleAnalytics.add(preparationKey);
    return;
  }
  await request(manifest, "/openapi/specs", {
    method: "POST",
    body: JSON.stringify({
      spec,
      slug: GOOGLE_ANALYTICS_INTEGRATION,
      name: "Google Analytics",
      description: "Read GA4 properties and reports.",
      family: "google",
      authenticationTemplate: googleAnalyticsAuthentication,
    }),
  });
  preparedGoogleAnalytics.add(preparationKey);
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

async function configureToolPolicies(
  manifest: ServerManifest,
  permissionCeiling?: ReadonlySet<AgentToolPermission>,
) {
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
      "agentTools.integrationsMarkConnected",
      "agentTools.uiPresentChart",
      "localTools.prospectsList",
      "localTools.prospectsSave",
      "localTools.trendsList",
      "localTools.trendsSave",
      "localTools.analyticsListDatasets",
      "localTools.analyticsSaveDataset",
      "localTools.contentList",
      "localTools.contentSave",
      "localTools.campaignsList",
      "localTools.campaignsSave",
      "localTools.actionRaise",
      "localTools.browserOpen",
      "localTools.browserSnapshot",
      "localTools.browserClick",
      "localTools.browserFill",
      "localTools.browserSelect",
      "localTools.browserPress",
      "localTools.brandProfileSave",
      "localTools.googleOAuthProvisionClient",
      "localTools.googleOAuthCaptureClient",
      "localTools.googleAnalyticsAuthorize",
      "localTools.googleAnalyticsComplete",
      "localTools.googleAnalyticsSelect",
      "localTools.integrationOpenHandoff",
      "localTools.integrationCaptureGeneratedCredential",
      "localTools.integrationOpenProviderPage",
      "localTools.specialistsDelegate",
      "localTools.setupList",
      "localTools.setupStart",
      "localTools.recurringWorkList",
      "localTools.recurringWorkPropose",
    ].map((name) => [name, "approve"] as const),
  ]);
  const governedTools = [...cloudTools, ...localTools].filter(
    (tool) => actions.has(tool.name) || permissionForExecutorTool(tool.name),
  );

  for (const tool of governedTools) {
    const pattern = tool.address.replace(/^tools\./, "");
    const permission = permissionForExecutorTool(tool.name);
    const action = permissionCeiling
      ? (executorPermissionPolicyAction(tool.name, permissionCeiling) ??
        actions.get(tool.name))
      : permission
        ? "approve"
        : actions.get(tool.name);
    if (!action) continue;
    if (permissionCeiling && permission) {
      const existing = policies.filter(
        (item) => item.owner === "org" && item.pattern === pattern,
      );
      const keep = existing.find(
        (item) => item.owner === "org" && item.action === action,
      );
      // Install the desired rule before removing stale rules. A failed sync
      // therefore preserves the prior ceiling instead of briefly leaving the
      // tool without an organization policy. Widening remains fail-closed
      // until the stale block is removed on this or a later retry.
      if (!keep) {
        await request(manifest, "/policies", {
          method: "POST",
          body: JSON.stringify({ owner: "org", pattern, action }),
        });
      }
      for (const policy of existing) {
        if (policy === keep) continue;
        await request(manifest, `/policies/${encodeURIComponent(policy.id)}`, {
          method: "DELETE",
          body: JSON.stringify({ owner: policy.owner }),
        });
      }
      continue;
    }
    if (
      !policies.some(
        (policy) =>
          policy.owner === "org" &&
          policy.action !== "approve" &&
          policyMatches(policy.pattern, pattern),
      ) &&
      !policies.some(
        (policy) => policy.owner === "org" && policy.pattern === pattern,
      )
    ) {
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
  let migratedKeychain = false;
  if (manifest) {
    try {
      await request(manifest, "/integrations");
    } catch {
      manifest = null;
      await rm(manifestPath(workspace.dataDir), { force: true });
    }
  }

  if (manifest) {
    const configuredService = await readFile(
      keychainMarkerPath(workspace.dataDir),
      "utf8",
    ).catch(() => "");
    if (configuredService.trim() !== workspace.keychainServiceName) {
      await execFileAsync(
        executorBinary(),
        ["daemon", "stop", "--base-url", manifest.connection.apiBaseUrl],
        {
          env: { ...process.env, EXECUTOR_DATA_DIR: workspace.dataDir },
          timeout: 15_000,
        },
      );
      await rm(manifestPath(workspace.dataDir), { force: true });
      manifest = null;
      migratedKeychain = true;
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
        env: {
          ...process.env,
          EXECUTOR_DATA_DIR: workspace.dataDir,
          EXECUTOR_KEYCHAIN_SERVICE_NAME: workspace.keychainServiceName,
        },
        timeout: 30_000,
      },
    );
    manifest = await waitForManifest(workspace.dataDir);
    await writeFile(
      keychainMarkerPath(workspace.dataDir),
      `${workspace.keychainServiceName}\n`,
    );
  }
  if (migratedKeychain) {
    const [connections, clients] = await Promise.all([
      request<Connection[]>(manifest, "/connections"),
      request<OAuthClient[]>(manifest, "/oauth/clients"),
    ]);
    if (
      connections.some(
        (connection) =>
          connection.owner === "org" &&
          connection.integration === GOOGLE_ANALYTICS_INTEGRATION &&
          connection.name === GOOGLE_ANALYTICS_CONNECTION,
      )
    ) {
      await request(
        manifest,
        `/connections/org/${GOOGLE_ANALYTICS_INTEGRATION}/${GOOGLE_ANALYTICS_CONNECTION}`,
        { method: "DELETE" },
      );
    }
    if (
      clients.some(
        (client) =>
          client.owner === "org" &&
          client.slug === GOOGLE_ANALYTICS_OAUTH_CLIENT,
      )
    ) {
      await request(
        manifest,
        `/oauth/clients/${GOOGLE_ANALYTICS_OAUTH_CLIENT}`,
        {
          method: "DELETE",
          body: JSON.stringify({ owner: "org" }),
        },
      );
    }
  }
  const localCapability =
    localWorkspaceCapabilities.get(workspaceId) ?? capability;
  await configureIntegration(manifest, capability);
  await configureLocalIntegration(manifest, localCapability);
  await replaceConnection(manifest, capability);
  await replaceConnection(
    manifest,
    localCapability,
    LOCAL_INTEGRATION,
    LOCAL_CONNECTION_NAME,
  );
  await configureToolPolicies(
    manifest,
    localWorkspacePermissionCeilings.get(workspaceId),
  );
  return workspace;
}

export async function syncExecutorAgentPermissionCeiling(
  workspaceId: string,
  permissions: readonly AgentToolPermission[],
) {
  registerExecutorAgentPermissionCeiling(workspaceId, permissions);
  const previous = permissionCeilingSyncs.get(workspaceId) ?? Promise.resolve();
  const sync = previous
    .catch(() => undefined)
    .then(async () => {
      const manifest = await readManifest(
        pathsForWorkspace(workspaceId).dataDir,
      );
      if (!manifest) return;
      await configureToolPolicies(
        manifest,
        localWorkspacePermissionCeilings.get(workspaceId) ?? new Set(),
      );
    });
  permissionCeilingSyncs.set(workspaceId, sync);
  try {
    await sync;
  } finally {
    if (permissionCeilingSyncs.get(workspaceId) === sync) {
      permissionCeilingSyncs.delete(workspaceId);
    }
  }
}

export async function executorHandoffUrl(workspaceId: string, url: string) {
  const manifest = await readManifest(pathsForWorkspace(workspaceId).dataDir);
  if (manifest?.connection.auth.kind !== "bearer") {
    throw new Error("The local connection service is not running.");
  }
  const handoff = new URL(url, manifest.connection.apiBaseUrl);
  if (
    handoff.origin !== new URL(manifest.connection.apiBaseUrl).origin ||
    (!handoff.pathname.includes("/integrations/") &&
      !handoff.pathname.includes("/resume/"))
  ) {
    throw new Error("The connection handoff URL is invalid.");
  }
  handoff.searchParams.set("_token", manifest.connection.auth.token);
  return handoff.toString();
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

async function prepareGoogleAnalyticsIntegration(
  workspaceId: string,
  capability: ExecutorCapability,
) {
  const workspace = await ensureExecutorWorkspace(workspaceId, capability);
  const manifest = await readManifest(workspace.dataDir);
  if (!manifest)
    throw new Error("The local connection service is not running.");
  await configureGoogleAnalyticsIntegration(manifest);
}

/** Prepare the setup surface after the user's explicit Connect action. */
export async function prepareIntegrationSetup(
  workspaceId: string,
  capability: ExecutorCapability,
  domain: string,
): Promise<PreparedIntegrationSetup> {
  const normalizedDomain = domain.trim().toLowerCase();
  const workspace = await ensureExecutorWorkspace(workspaceId, capability);
  const manifest = await readManifest(workspace.dataDir);
  if (!manifest) {
    throw new Error("The local connection service is not running.");
  }
  await configureIntegrationSetupPolicies(manifest, request, policyMatches);
  if (normalizedDomain === "analytics.googleapis.com") {
    await prepareGoogleAnalyticsIntegration(workspaceId, capability);
    return { recipeId: "google-analytics" };
  }
  const recipe = browserCredentialSetupRecipe(normalizedDomain);
  if (recipe) {
    await configureBrowserCredentialIntegration(manifest, recipe, request);
    return {
      integrationSlug: recipe.integration.slug,
      recipeId: recipe.id,
    };
  }
  return { recipeId: normalizedDomain };
}

async function replaceGoogleAnalyticsOAuthClient(
  manifest: ServerManifest,
  credentials: { clientId: string; clientSecret: string },
) {
  const clients = await request<OAuthClient[]>(manifest, "/oauth/clients");
  if (
    clients.some(
      (client) =>
        client.owner === "org" && client.slug === GOOGLE_ANALYTICS_OAUTH_CLIENT,
    )
  ) {
    await request(manifest, `/oauth/clients/${GOOGLE_ANALYTICS_OAUTH_CLIENT}`, {
      method: "DELETE",
      body: JSON.stringify({ owner: "org" }),
    });
  }
  await request(manifest, "/oauth/clients", {
    method: "POST",
    body: JSON.stringify({
      owner: "org",
      slug: GOOGLE_ANALYTICS_OAUTH_CLIENT,
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      grant: "authorization_code",
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      originIntegration: GOOGLE_ANALYTICS_INTEGRATION,
    }),
  });
}

export async function storeGoogleAnalyticsOAuthClient(
  workspaceId: string,
  capability: ExecutorCapability,
  credentials: { clientId: string; clientSecret: string },
) {
  const workspace = await ensureExecutorWorkspace(workspaceId, capability);
  const manifest = await readManifest(workspace.dataDir);
  if (!manifest)
    throw new Error("The local connection service is not running.");
  await configureGoogleAnalyticsIntegration(manifest);
  await replaceGoogleAnalyticsOAuthClient(manifest, credentials);
}

export async function startGoogleAnalyticsAuthorization(
  workspaceId: string,
  capability: ExecutorCapability,
  credentials?: { clientId: string; clientSecret: string },
) {
  const workspace = await ensureExecutorWorkspace(workspaceId, capability);
  const manifest = await readManifest(workspace.dataDir);
  if (!manifest)
    throw new Error("The local connection service is not running.");
  await configureGoogleAnalyticsIntegration(manifest);

  if (credentials) {
    await replaceGoogleAnalyticsOAuthClient(manifest, credentials);
  } else if (
    !(await request<OAuthClient[]>(manifest, "/oauth/clients")).some(
      (client) =>
        client.owner === "org" && client.slug === GOOGLE_ANALYTICS_OAUTH_CLIENT,
    )
  ) {
    throw new Error("Google Analytics OAuth credentials are required.");
  }

  const redirectUri = new URL(
    "/api/oauth/callback",
    manifest.connection.apiBaseUrl,
  ).toString();
  const started = await request<OAuthStart>(manifest, "/oauth/start", {
    method: "POST",
    body: JSON.stringify({
      client: GOOGLE_ANALYTICS_OAUTH_CLIENT,
      clientOwner: "org",
      owner: "org",
      name: GOOGLE_ANALYTICS_CONNECTION,
      integration: GOOGLE_ANALYTICS_INTEGRATION,
      template: GOOGLE_ANALYTICS_AUTH_TEMPLATE,
      identityLabel: "Google Analytics",
      redirectUri,
    }),
  });
  if (
    started.status !== "redirect" ||
    !started.authorizationUrl ||
    !started.state
  ) {
    throw new Error("Chief could not start Google authorization.");
  }
  const authorizationUrl = new URL(started.authorizationUrl);
  if (
    authorizationUrl.protocol !== "https:" ||
    authorizationUrl.hostname !== "accounts.google.com"
  ) {
    throw new Error("Google returned an invalid authorization URL.");
  }
  return {
    authorizationUrl: authorizationUrl.toString(),
    state: started.state,
  };
}

export async function awaitGoogleAnalyticsAuthorization(
  workspaceId: string,
  state: string,
) {
  const manifest = await readManifest(pathsForWorkspace(workspaceId).dataDir);
  if (!manifest)
    throw new Error("The local connection service is not running.");
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const result = await request<OAuthResult | null>(
      manifest,
      `/oauth/await/${encodeURIComponent(state)}`,
    );
    if (result) {
      if (!result.ok) {
        throw new Error(
          result.errorDetails ?? result.error ?? "Google authorization failed.",
        );
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  await request(manifest, "/oauth/cancel", {
    method: "POST",
    body: JSON.stringify({ state }),
  }).catch(() => undefined);
  throw new Error("Google authorization timed out.");
}

export async function listExecutorConnections(
  workspaceId: string,
  capability: ExecutorCapability,
) {
  const workspace = await ensureExecutorWorkspace(workspaceId, capability);
  const manifest = await readManifest(workspace.dataDir);
  if (!manifest)
    throw new Error("The local connection service is not running.");
  return request<Connection[]>(manifest, "/connections");
}

/** Stores a browser-generated bearer token directly in Executor's keychain. */
export async function storeGeneratedCredentialConnection(
  workspaceId: string,
  capability: ExecutorCapability,
  input: {
    domain: string;
    integrationSlug: string;
    credential: string;
  },
) {
  const workspace = await ensureExecutorWorkspace(workspaceId, capability);
  const manifest = await readManifest(workspace.dataDir);
  if (!manifest)
    throw new Error("The local connection service is not running.");
  return storeBrowserGeneratedCredential(manifest, input, request);
}

export async function inspectGoogleAnalyticsConfiguration(
  workspaceId: string,
  capability: ExecutorCapability,
) {
  const workspace = await ensureExecutorWorkspace(workspaceId, capability);
  const manifest = await readManifest(workspace.dataDir);
  if (!manifest)
    throw new Error("The local connection service is not running.");
  const [connections, clients] = await Promise.all([
    request<Connection[]>(manifest, "/connections"),
    request<OAuthClient[]>(manifest, "/oauth/clients"),
  ]);
  return {
    connection: connections.find(
      (connection) =>
        connection.owner === "org" &&
        connection.integration === GOOGLE_ANALYTICS_INTEGRATION &&
        connection.name === GOOGLE_ANALYTICS_CONNECTION,
    ),
    oauthClientConfigured: clients.some(
      (client) =>
        client.owner === "org" && client.slug === GOOGLE_ANALYTICS_OAUTH_CLIENT,
    ),
  };
}

export async function disconnectGoogleAnalyticsConnection(
  workspaceId: string,
  capability: ExecutorCapability,
) {
  const workspace = await ensureExecutorWorkspace(workspaceId, capability);
  const manifest = await readManifest(workspace.dataDir);
  if (!manifest)
    throw new Error("The local connection service is not running.");
  const connections = await request<Connection[]>(manifest, "/connections");
  const exists = connections.some(
    (connection) =>
      connection.owner === "org" &&
      connection.integration === GOOGLE_ANALYTICS_INTEGRATION &&
      connection.name === GOOGLE_ANALYTICS_CONNECTION,
  );
  if (exists) {
    await request(
      manifest,
      `/connections/org/${GOOGLE_ANALYTICS_INTEGRATION}/${GOOGLE_ANALYTICS_CONNECTION}`,
      { method: "DELETE" },
    );
  }
}

export async function verifyGoogleAnalyticsConnection(
  workspaceId: string,
  capability: ExecutorCapability,
  selectedPropertyId?: string,
): Promise<
  | { status: "selection-required"; properties: GoogleAnalyticsProperty[] }
  | { status: "connected"; property: GoogleAnalyticsProperty }
> {
  const workspace = await ensureExecutorWorkspace(workspaceId, capability);
  const manifest = await readManifest(workspace.dataDir);
  if (!manifest)
    throw new Error("The local connection service is not running.");
  await configureGoogleAnalyticsIntegration(manifest);
  const tools = await request<Tool[]>(
    manifest,
    `/tools?integration=${GOOGLE_ANALYTICS_INTEGRATION}&owner=org&connection=${GOOGLE_ANALYTICS_CONNECTION}&includeAnnotations=true`,
  );
  const catalog = await Promise.all(
    tools.map(async (tool) => ({
      tool,
      schema: await request<ToolSchemaView>(
        manifest,
        `/tools/schema?address=${encodeURIComponent(tool.address)}`,
      ),
    })),
  );
  const accountTool = catalog.find(({ schema }) => {
    const properties = schema.inputSchema?.properties ?? {};
    return (
      "pageSize" in properties &&
      "pageToken" in properties &&
      !("property" in properties) &&
      !("body" in properties)
    );
  })?.tool;
  const reportTool = catalog.find(({ schema }) => {
    const input = schema.inputSchema;
    return (
      input?.required?.includes("property") === true &&
      input.properties?.body?.$ref?.endsWith("/RunReportRequest") === true
    );
  })?.tool;
  if (!accountTool || !reportTool) {
    throw new Error("Google Analytics reporting tools are unavailable.");
  }
  const accountData = (await executeTool(manifest, accountTool, {
    pageSize: 200,
  })) as {
    accountSummaries?: {
      displayName?: string;
      propertySummaries?: { property?: string; displayName?: string }[];
    }[];
  };
  const properties = (accountData.accountSummaries ?? []).flatMap((account) =>
    (account.propertySummaries ?? []).flatMap((property) =>
      property.property
        ? [
            {
              accountName: account.displayName ?? "Google Analytics",
              propertyId: property.property,
              propertyName: property.displayName ?? property.property,
            },
          ]
        : [],
    ),
  );
  if (properties.length === 0) {
    throw new Error("This Google account has no accessible GA4 properties.");
  }
  const normalizedSelection = selectedPropertyId?.startsWith("properties/")
    ? selectedPropertyId
    : selectedPropertyId
      ? `properties/${selectedPropertyId}`
      : undefined;
  if (!normalizedSelection && properties.length > 1) {
    return { status: "selection-required", properties };
  }
  const property = normalizedSelection
    ? properties.find(
        (candidate) => candidate.propertyId === normalizedSelection,
      )
    : properties[0];
  if (!property) {
    throw new Error("The selected Google Analytics property is unavailable.");
  }

  await executeTool(manifest, reportTool, {
    property: property.propertyId,
    body: {
      dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "activeUsers" }],
      limit: "1",
    },
  });
  await configureReadOnlyConnectionPolicies(manifest, tools, request);
  await request(
    manifest,
    `/connections/org/${GOOGLE_ANALYTICS_INTEGRATION}/${GOOGLE_ANALYTICS_CONNECTION}`,
    {
      method: "PATCH",
      body: JSON.stringify({ identityLabel: property.propertyName }),
    },
  );
  return { status: "connected", property };
}
