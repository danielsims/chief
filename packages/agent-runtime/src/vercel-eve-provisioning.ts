import type { Attributes, Span } from "@opentelemetry/api";
import { z } from "zod";

import type {
  EveAgentProvisioningInput,
  EveAgentProvisioningProgress,
  EveAgentProvisioningResult,
  VercelEveDestinationCatalog,
} from "./types.js";
import {
  recordEveDeploymentEvent,
  withEveDeploymentSpan,
} from "./eve-deployment-telemetry.js";

const deploymentSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    readyState: z.string().nullish(),
    url: z.string().nullish(),
    inspectorUrl: z.string().url().nullish(),
  })
  .passthrough();
const teamsSchema = z.object({
  teams: z.array(
    z.object({ id: z.string().min(1), name: z.string(), slug: z.string() }),
  ),
});
const projectsSchema = z.object({
  projects: z.array(
    z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        framework: z.string().nullish(),
        latestDeployments: z
          .array(
            z.object({
              target: z.string().nullish(),
              url: z.string().nullish(),
            }),
          )
          .nullish(),
      })
      .passthrough(),
  ),
});
const unknownSchema = z.unknown();
const deploymentEventsSchema = z.array(
  z
    .object({
      payload: z
        .object({ text: z.string().optional() })
        .passthrough()
        .optional(),
    })
    .passthrough(),
);
const secretKeys = new Set([
  "CHIEF_CHANNEL_TOKEN",
  "CHIEF_DELIVERY_SIGNING_SECRET",
]);
const environmentKeys = [
  "CHIEF_AGENT_ID",
  "CHIEF_CHANNEL_TOKEN",
  "CHIEF_DELIVERY_SIGNING_KEY_ID",
  "CHIEF_DELIVERY_SIGNING_SECRET",
  "CHIEF_RELAY_URL",
  "CHIEF_WORKSPACE_ID",
] as const;

interface DestinationListOptions {
  token: string;
  teamId?: string;
  fetcher?: typeof fetch;
}

interface ProvisioningOptions {
  token: string;
  input: EveAgentProvisioningInput;
  fetcher?: typeof fetch;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  onProgress?: (progress: EveAgentProvisioningProgress) => void;
}

export async function listVercelEveDestinations(
  options: DestinationListOptions,
): Promise<VercelEveDestinationCatalog> {
  const attributes: Attributes = {};
  if (options.teamId) attributes["vercel.team.id"] = options.teamId;
  return await withEveDeploymentSpan(
    "chief.eve.destination.list",
    attributes,
    async (span) => {
      recordEveDeploymentEvent(span, "destination_list_started");
      const catalog = await listVercelEveDestinationsInternal(options);
      recordEveDeploymentEvent(span, "destination_list_completed", {
        "vercel.team.count": catalog.teams.length,
        "vercel.project.count": catalog.projects.length,
      });
      return catalog;
    },
  );
}

async function listVercelEveDestinationsInternal({
  token,
  teamId,
  fetcher = fetch,
}: DestinationListOptions): Promise<VercelEveDestinationCatalog> {
  const { teams } = await requestJson({
    fetcher,
    token,
    url: vercelUrl("/v2/teams", { limit: "100" }),
    schema: teamsSchema,
    errorMessage:
      "Vercel rejected this access token. Create a new token and try again.",
  });
  if (!teamId) return { teams, projects: [] };
  if (!teams.some((team) => team.id === teamId)) {
    throw new Error("Choose a Vercel team available to this connection.");
  }
  const response = await requestJson({
    fetcher,
    token,
    url: vercelUrl("/v9/projects", { limit: "100", teamId }),
    schema: projectsSchema,
  });
  return {
    teams,
    selectedTeamId: teamId,
    projects: response.projects.map((project) => {
      const production = project.latestDeployments?.find(
        (deployment) => deployment.target === "production" && deployment.url,
      );
      const option = {
        id: project.id,
        name: project.name,
      };
      if (project.framework)
        Object.assign(option, { framework: project.framework });
      if (production?.url) {
        Object.assign(option, {
          productionDeploymentUrl: `https://${production.url}`,
        });
      }
      return option;
    }),
  };
}

export async function provisionVercelEveDeployment(
  options: ProvisioningOptions,
): Promise<EveAgentProvisioningResult> {
  const lifecycle: { createdProjectId?: string } = {};
  const attributes: Attributes = {
    "chief.agent.id": options.input.environment.CHIEF_AGENT_ID,
    "chief.workspace.id": options.input.environment.CHIEF_WORKSPACE_ID,
    "vercel.team.id": options.input.teamId,
    "vercel.project.name": options.input.project.projectName,
    "vercel.project.action": options.input.project.kind,
  };
  if (options.input.project.kind === "existing") {
    attributes["vercel.project.id"] = options.input.project.projectId;
  }
  return await withEveDeploymentSpan(
    "chief.eve.deploy",
    attributes,
    async (span) => {
      try {
        return await provisionVercelEveDeploymentInternal(
          options,
          span,
          lifecycle,
        );
      } catch (error) {
        if (
          options.input.project.kind === "new" &&
          lifecycle.createdProjectId
        ) {
          recordEveDeploymentEvent(span, "rollback_started", {
            "vercel.project.id": lifecycle.createdProjectId,
          });
          const rolledBack = await deleteVercelProject({
            fetcher: options.fetcher ?? fetch,
            projectId: lifecycle.createdProjectId,
            teamId: options.input.teamId,
            token: options.token,
          });
          recordEveDeploymentEvent(
            span,
            rolledBack ? "rollback_completed" : "rollback_failed",
            {
              "vercel.project.id": lifecycle.createdProjectId,
            },
          );
        }
        throw error;
      }
    },
  );
}

async function provisionVercelEveDeploymentInternal(
  {
    token,
    input,
    fetcher = fetch,
    pollIntervalMs = 2_000,
    maxWaitMs = 180_000,
    onProgress,
  }: ProvisioningOptions,
  span: Span,
  lifecycle: { createdProjectId?: string },
): Promise<EveAgentProvisioningResult> {
  reportProgress(span, onProgress, { phase: "validating" });
  const catalog = await listVercelEveDestinations({
    token,
    teamId: input.teamId,
    fetcher,
  });
  if (input.project.kind === "existing") {
    const projectId = input.project.projectId;
    const selected = catalog.projects.find(
      (project) => project.id === projectId,
    );
    if (!selected || selected.name !== input.project.projectName) {
      throw new Error("Choose a Vercel project from the selected team.");
    }
  }

  const files = eveProjectFiles(input);
  reportProgress(span, onProgress, { phase: "uploading" });
  const uploaded = await Promise.all(
    files.map(async (file) => ({
      file: file.path,
      size: new TextEncoder().encode(file.contents).byteLength,
      sha: await uploadFile({
        contents: file.contents,
        fetcher,
        teamId: input.teamId,
        token,
      }),
    })),
  );

  reportProgress(span, onProgress, { phase: "deploying" });
  const deployment = await requestJson({
    fetcher,
    token,
    url: vercelUrl("/v13/deployments", {
      teamId: input.teamId,
      skipAutoDetectionConfirmation: "1",
    }),
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(deploymentRequestBody(input, uploaded)),
    },
    schema: deploymentSchema,
  });
  if (input.project.kind === "new") {
    lifecycle.createdProjectId = deployment.projectId;
  }

  reportProgress(
    span,
    onProgress,
    deploymentProgress("configuring", deployment),
  );
  await persistEnvironment({
    environment: input.environment,
    fetcher,
    projectId: deployment.projectId,
    teamId: input.teamId,
    token,
  });

  reportProgress(span, onProgress, deploymentProgress("waiting", deployment));
  const ready = await waitForDeployment({
    deploymentId: deployment.id,
    fetcher,
    maxWaitMs,
    pollIntervalMs,
    teamId: input.teamId,
    token,
  });
  const deploymentUrl = ready.url
    ? `https://${ready.url}`
    : deployment.url
      ? `https://${deployment.url}`
      : undefined;
  if (!deploymentUrl)
    throw new Error("Vercel did not return a deployment URL.");

  const checking: EveAgentProvisioningProgress = {
    phase: "checking",
    projectId: ready.projectId,
    deploymentId: ready.id,
    deploymentUrl,
  };
  if (ready.inspectorUrl) checking.inspectorUrl = ready.inspectorUrl;
  reportProgress(span, onProgress, checking);
  await checkHealth({ deploymentUrl, input, fetcher });
  const result: EveAgentProvisioningResult = {
    projectId: ready.projectId,
    deploymentId: ready.id,
    deploymentUrl,
  };
  if (ready.inspectorUrl) result.inspectorUrl = ready.inspectorUrl;
  return result;
}

function deploymentRequestBody(
  input: EveAgentProvisioningInput,
  files: { file: string; size: number; sha: string }[],
) {
  const body = {
    name: input.project.projectName,
    files,
    target: "production",
    env: input.environment,
    projectSettings: {
      buildCommand: "npm run build",
      installCommand: "npm install",
      outputDirectory: ".output",
      framework: null,
      nodeVersion: "24.x",
    },
  };
  if (input.project.kind === "existing") {
    Object.assign(body, { project: input.project.projectId });
  }
  return body;
}

function deploymentProgress(
  phase: "configuring" | "waiting",
  deployment: z.infer<typeof deploymentSchema>,
): EveAgentProvisioningProgress {
  const progress: EveAgentProvisioningProgress = {
    phase,
    projectId: deployment.projectId,
    deploymentId: deployment.id,
  };
  if (deployment.url) progress.deploymentUrl = `https://${deployment.url}`;
  if (deployment.inspectorUrl) progress.inspectorUrl = deployment.inspectorUrl;
  return progress;
}

function reportProgress(
  span: Span,
  onProgress: ProvisioningOptions["onProgress"],
  progress: EveAgentProvisioningProgress,
) {
  span.setAttribute("chief.eve.phase", progress.phase);
  if (progress.projectId)
    span.setAttribute("vercel.project.id", progress.projectId);
  if (progress.deploymentId) {
    span.setAttribute("vercel.deployment.id", progress.deploymentId);
  }
  const attributes: Attributes = {};
  if (progress.projectId) attributes["vercel.project.id"] = progress.projectId;
  if (progress.deploymentId) {
    attributes["vercel.deployment.id"] = progress.deploymentId;
  }
  recordEveDeploymentEvent(span, progress.phase, attributes);
  onProgress?.(progress);
}

async function deleteVercelProject({
  fetcher,
  projectId,
  teamId,
  token,
}: {
  fetcher: typeof fetch;
  projectId: string;
  teamId: string;
  token: string;
}) {
  return await requestJson({
    fetcher,
    token,
    url: vercelUrl(`/v9/projects/${encodeURIComponent(projectId)}`, { teamId }),
    init: { method: "DELETE" },
    schema: unknownSchema,
  }).then(
    () => true,
    () => false,
  );
}

async function uploadFile({
  contents,
  fetcher,
  teamId,
  token,
}: {
  contents: string;
  fetcher: typeof fetch;
  teamId: string;
  token: string;
}) {
  const body = new TextEncoder().encode(contents);
  const sha = bytesToHex(
    new Uint8Array(await crypto.subtle.digest("SHA-1", body)),
  );
  await requestJson({
    fetcher,
    token,
    url: vercelUrl("/v2/files", { teamId }),
    init: {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-vercel-digest": sha,
        "x-vercel-size": String(body.byteLength),
      },
      body,
    },
    schema: unknownSchema,
  });
  return sha;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function persistEnvironment({
  environment,
  fetcher,
  projectId,
  teamId,
  token,
}: {
  environment: EveAgentProvisioningInput["environment"];
  fetcher: typeof fetch;
  projectId: string;
  teamId: string;
  token: string;
}) {
  await requestJson({
    fetcher,
    token,
    url: vercelUrl(`/v10/projects/${encodeURIComponent(projectId)}/env`, {
      teamId,
      upsert: "true",
    }),
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        environmentKeys.map((key) => ({
          key,
          value: environment[key],
          type: secretKeys.has(key) ? "sensitive" : "encrypted",
          target: ["production", "preview"],
          comment: "Managed by Chief for the Eve channel.",
        })),
      ),
    },
    schema: unknownSchema,
  });
}

async function checkHealth({
  deploymentUrl,
  input,
  fetcher,
}: {
  deploymentUrl: string;
  input: EveAgentProvisioningInput;
  fetcher: typeof fetch;
}) {
  const response = await fetcher(
    new URL("/channels/chief/health", deploymentUrl),
    {
      headers: {
        authorization: `Bearer ${input.environment.CHIEF_CHANNEL_TOKEN}`,
      },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `The Eve deployment built, but its Chief channel returned HTTP ${response.status}.`,
    );
  }
}

async function waitForDeployment({
  deploymentId,
  fetcher,
  maxWaitMs,
  pollIntervalMs,
  teamId,
  token,
}: {
  deploymentId: string;
  fetcher: typeof fetch;
  maxWaitMs: number;
  pollIntervalMs: number;
  teamId: string;
  token: string;
}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxWaitMs) {
    const deployment = await requestJson({
      fetcher,
      token,
      url: vercelUrl(`/v13/deployments/${encodeURIComponent(deploymentId)}`, {
        teamId,
      }),
      schema: deploymentSchema,
    });
    if (deployment.readyState === "READY") return deployment;
    if (["ERROR", "CANCELED"].includes(deployment.readyState ?? "")) {
      const detail = await deploymentFailureDetail({
        deploymentId,
        fetcher,
        teamId,
        token,
      });
      throw new Error(
        detail
          ? `Vercel could not build the Eve agent: ${detail}`
          : "Vercel could not build the Eve agent. Open the deployment logs for details.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(
    "Vercel is still building the Eve agent. Open the deployment to check its progress.",
  );
}

async function deploymentFailureDetail({
  deploymentId,
  fetcher,
  teamId,
  token,
}: {
  deploymentId: string;
  fetcher: typeof fetch;
  teamId: string;
  token: string;
}) {
  const events = await requestJson({
    fetcher,
    token,
    url: vercelUrl(
      `/v3/deployments/${encodeURIComponent(deploymentId)}/events`,
      { builds: "1", direction: "backward", limit: "100", teamId },
    ),
    schema: deploymentEventsSchema,
  }).catch(() => []);
  const line = events
    .map((event) => event.payload?.text?.trim())
    .find((text) => Boolean(text));
  return line ? redactLogLine(line).slice(0, 300) : undefined;
}

function redactLogLine(value: string) {
  return value
    .replace(/Bearer\s+\S+/giu, "Bearer [redacted]")
    .replace(
      /(TOKEN|SECRET|SIGNING_KEY|AUTHORIZATION)(\s*[:=]\s*)\S+/giu,
      "$1$2[redacted]",
    );
}

export function eveProjectFiles(input: EveAgentProvisioningInput) {
  return [
    {
      path: "package.json",
      contents: `${JSON.stringify(
        {
          name: input.project.projectName,
          private: true,
          version: "0.1.0",
          type: "module",
          engines: { node: "24.x" },
          scripts: { build: "eve build" },
          dependencies: { ai: "7.0.30", eve: "0.24.6", zod: "3.25.76" },
        },
        null,
        2,
      )}\n`,
    },
    {
      path: "agent/agent.ts",
      contents: `import { defineAgent } from "eve";\n\nexport default defineAgent({\n  model: ${JSON.stringify(input.agent.model)},\n});\n`,
    },
    {
      path: "agent/instructions.md",
      contents: `${input.agent.instructions.trim()}\n`,
    },
    { path: "agent/channels/chief.ts", contents: chiefChannelSource },
  ];
}

const chiefChannelSource = `import { createHash, timingSafeEqual } from "node:crypto";
import { defineChannel, GET, POST } from "eve/channels";
import { z } from "zod";

const deliverySchema = z.object({ payload: z.object({
  deliveryId: z.string(), sessionAddress: z.string(),
  continuation: z.object({ capability: z.string() }),
  message: z.object({ body: z.string() }),
}) });
type ChiefState = { deliveryId: string; capability: string };
const reasoningBuckets = new Map<string, number>();
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(\`\${name} is required.\`);
  return value;
};
const tokenHash = (value: string) => createHash("sha256").update(value).digest();
const authorized = (request: Request) => timingSafeEqual(
  tokenHash(request.headers.get("authorization") ?? ""),
  tokenHash(\`Bearer \${required("CHIEF_CHANNEL_TOKEN")}\`),
);
const activityId = (value: string) => value.slice(0, 128);
const activityText = (value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return (text ?? "").slice(0, 100_000);
};
const relayUrl = (path: "activity" | "messages") => new URL(
  \`/v1/workspaces/\${encodeURIComponent(required("CHIEF_WORKSPACE_ID"))}/agents/\${encodeURIComponent(required("CHIEF_AGENT_ID"))}/channel/\${path}\`,
  required("CHIEF_RELAY_URL"),
);
const postToChief = async (path: "activity" | "messages", body: unknown) => {
  const response = await fetch(relayUrl(path), {
    method: "POST",
    headers: { "authorization": \`Bearer \${required("CHIEF_CHANNEL_TOKEN")}\`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(\`Chief returned HTTP \${response.status}.\`);
};
const postActivity = async (
  channel: { state: ChiefState },
  sessionId: string,
  component: Record<string, unknown>,
) => {
  await postToChief("activity", {
    deliveryId: channel.state.deliveryId,
    continuation: { capability: channel.state.capability },
    sessionId,
    component,
  }).catch((error: unknown) => {
    console.error("[chief-activity] publish failed", {
      error: error instanceof Error ? error.message : String(error),
      sessionId,
    });
  });
};
const actionName = (action: { kind: string; toolName?: string; subagentName?: string; remoteAgentName?: string }) =>
  action.toolName ?? action.subagentName ?? action.remoteAgentName ?? (action.kind === "load-skill" ? "Load skill" : action.kind);
const actionResult = (result: { kind: string; toolName?: string; subagentName?: string; name?: string; output: unknown; isError?: boolean }) => ({
  name: result.toolName ?? result.subagentName ?? result.name ?? result.kind,
  output: activityText(result.output),
});

export default defineChannel<ChiefState>({
  state: { deliveryId: "", capability: "" },
  routes: [
    GET("/channels/chief/health", async (request) => {
      if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
      return Response.json({ status: "ready", agentId: required("CHIEF_AGENT_ID"), workspaceId: required("CHIEF_WORKSPACE_ID") });
    }),
    POST("/channels/chief/messages", async (request, { send }) => {
      if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
      const input = deliverySchema.parse(await request.json());
      const session = await send(input.payload.message.body, {
        auth: null,
        continuationToken: input.payload.sessionAddress,
        state: { deliveryId: input.payload.deliveryId, capability: input.payload.continuation.capability },
      });
      return Response.json({ status: "accepted", sessionId: session.id });
    }),
  ],
  events: {
    async "reasoning.appended"(event, channel, context) {
      const key = \`\${event.turnId}:\${event.stepIndex}\`;
      const bucket = Math.floor(event.reasoningSoFar.length / 500);
      if (reasoningBuckets.get(key) === bucket) return;
      reasoningBuckets.set(key, bucket);
      await postActivity(channel, context.session.id, {
        id: activityId(\`reasoning:\${key}\`), kind: "thinking", version: 1,
        payload: { text: event.reasoningSoFar, status: "working", providerSessionId: context.session.id },
      });
    },
    async "reasoning.completed"(event, channel, context) {
      const key = \`\${event.turnId}:\${event.stepIndex}\`;
      reasoningBuckets.delete(key);
      await postActivity(channel, context.session.id, {
        id: activityId(\`reasoning:\${key}\`), kind: "thinking", version: 1,
        payload: { text: event.reasoning, status: "completed", providerSessionId: context.session.id },
      });
    },
    async "actions.requested"(event, channel, context) {
      for (const action of event.actions) {
        await postActivity(channel, context.session.id, {
          id: activityId(action.callId), kind: "tool", version: 1,
          payload: { name: actionName(action), status: "running", input: activityText(action.input), providerSessionId: context.session.id },
        });
      }
    },
    async "action.result"(event, channel, context) {
      const result = actionResult(event.result);
      await postActivity(channel, context.session.id, {
        id: activityId(event.result.callId), kind: "tool", version: 1,
        payload: {
          name: result.name,
          status: event.status === "completed" ? "completed" : "failed",
          ...(event.status === "completed" ? { output: result.output } : { error: event.error?.message ?? result.output }),
          providerSessionId: context.session.id,
        },
      });
    },
    async "turn.failed"(event, channel, context) {
      await postActivity(channel, context.session.id, {
        id: activityId(\`error:\${event.turnId}\`), kind: "error", version: 1,
        payload: { code: event.code, title: "Run interrupted", message: event.message, retryable: "true", providerSessionId: context.session.id },
      });
    },
    async "message.completed"(event, channel, context) {
      if (event.finishReason === "tool-calls" || !event.message) return;
      await postToChief("messages", {
          deliveryId: channel.state.deliveryId,
          continuation: { capability: channel.state.capability },
          sessionId: context.session.id,
          body: event.message,
      });
    },
  },
});
`;

function vercelUrl(path: string, query?: Readonly<Record<string, string>>) {
  const url = new URL(path, "https://api.vercel.com");
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function requestJson<T>({
  fetcher,
  init,
  schema,
  token,
  url,
  errorMessage,
}: {
  fetcher: typeof fetch;
  init?: RequestInit;
  schema: z.ZodType<T>;
  token: string;
  url: URL;
  errorMessage?: string;
}): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  const response = await fetcher(url, {
    ...init,
    headers,
    signal: init?.signal ?? AbortSignal.timeout(20_000),
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("Vercel did not respond within 20 seconds.");
    }
    throw error;
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = z
      .object({ error: z.object({ message: z.string() }).optional() })
      .passthrough()
      .safeParse(body);
    throw new Error(
      errorMessage ??
        (parsed.success && parsed.data.error?.message
          ? parsed.data.error.message
          : `Vercel returned ${response.status}.`),
    );
  }
  return schema.parse(body);
}
