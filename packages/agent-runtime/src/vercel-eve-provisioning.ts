import type { Attributes, Span } from "@opentelemetry/api";

import type { GitFile } from "./git-objects.js";
import type {
  EveAgentProvisioningInput,
  EveAgentProvisioningProgress,
  EveAgentProvisioningResult,
} from "./types.js";
import type { EveProjectFile } from "./vercel-eve-files.js";
import {
  recordEveDeploymentEvent,
  withEveDeploymentSpan,
} from "./eve-deployment-telemetry.js";
import {
  buildGitRepository,
  chiefGitRemoteUrl,
  chiefGitRepoSlug,
} from "./git-objects.js";
import {
  deploymentSchema,
  environmentKeysSchema,
  projectIdentitySchema,
  requestJson,
  unknownSchema,
  vercelUrl,
} from "./vercel-eve-api.js";
import {
  assertProjectNameAllowed,
  listVercelEveDestinations,
  resolveUnusedProjectName,
} from "./vercel-eve-destinations.js";
import { eveProjectFiles } from "./vercel-eve-files.js";
import { deploymentProgress, waitForDeployment } from "./vercel-eve-logs.js";

export {
  availableVercelProjectName,
  isReservedVercelProjectName,
  preferredVercelProjectName,
  suggestedVercelProjectName,
  vercelProjectSlug,
} from "./vercel-project-names.js";

export { listVercelEveDestinations };
export { eveProjectFiles };
export {
  formatVercelDeploymentLogs,
  parseDeploymentEvents,
  sanitizeDeploymentLogText,
} from "./vercel-eve-logs.js";

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

interface ProvisioningOptions {
  token: string;
  input: EveAgentProvisioningInput;
  sourceFiles?: readonly EveProjectFile[];
  git?: { remoteUrl: string; commitSha?: string };
  fetcher?: typeof fetch;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  onProgress?: (progress: EveAgentProvisioningProgress) => void;
}

export async function provisionVercelEveDeployment(
  options: ProvisioningOptions,
): Promise<EveAgentProvisioningResult> {
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
    async (span) => await provisionVercelEveDeploymentInternal(options, span),
  );
}

async function provisionVercelEveDeploymentInternal(
  {
    token,
    input,
    sourceFiles,
    git,
    fetcher = fetch,
    pollIntervalMs = 2_000,
    maxWaitMs = 180_000,
    onProgress,
  }: ProvisioningOptions,
  span: Span,
): Promise<EveAgentProvisioningResult> {
  reportProgress(span, onProgress, { phase: "validating" });
  assertProjectNameAllowed(input.project.projectName);
  const catalog = await listVercelEveDestinations({
    token,
    teamId: input.teamId,
    fetcher,
  });
  const resolvedInput =
    input.project.kind === "existing"
      ? input
      : {
          ...input,
          project: {
            kind: "new" as const,
            projectName: await resolveUnusedProjectName({
              fetcher,
              preferredName: input.project.projectName,
              teamId: input.teamId,
              token,
            }),
          },
        };
  assertProjectNameAllowed(resolvedInput.project.projectName);
  if (resolvedInput.project.kind === "existing") {
    const projectId = resolvedInput.project.projectId;
    const selected = catalog.projects.find(
      (project) => project.id === projectId,
    );
    if (!selected || selected.name !== resolvedInput.project.projectName) {
      throw new Error("Choose a Vercel project from the selected team.");
    }
  } else if (resolvedInput.project.projectName !== input.project.projectName) {
    reportProgress(span, onProgress, {
      phase: "validating",
      logs: [
        {
          source: "status",
          text: `"${input.project.projectName}" is taken. Using ${resolvedInput.project.projectName}.`,
        },
      ],
    });
  }

  const files =
    sourceFiles &&
    resolvedInput.project.projectName === input.project.projectName
      ? sourceFiles
      : eveProjectFiles(resolvedInput);
  assertChiefChannelPackaged(files);
  const gitMetadata = await vercelGitMetadata(resolvedInput, files, git);
  // Reserve a new project atomically before uploading source or credentials.
  // A name lookup alone races with other creators; deployments may reuse names.
  const project = await requestJson({
    fetcher,
    token,
    url: vercelUrl(
      resolvedInput.project.kind === "new"
        ? "/v11/projects"
        : `/v9/projects/${encodeURIComponent(resolvedInput.project.projectId)}`,
      { teamId: input.teamId },
    ),
    init:
      resolvedInput.project.kind === "new"
        ? {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: resolvedInput.project.projectName,
              framework: "eve",
              publicSource: false,
            }),
          }
        : { method: "GET" },
    schema: projectIdentitySchema,
  });
  if (
    project.accountId !== input.teamId ||
    project.name !== resolvedInput.project.projectName ||
    (resolvedInput.project.kind === "existing" &&
      project.id !== resolvedInput.project.projectId) ||
    (resolvedInput.project.kind === "new" &&
      catalog.projects.some((existing) => existing.id === project.id))
  ) {
    throw new Error(
      "Vercel returned a different project. Chief stopped before uploading code or credentials.",
    );
  }
  const boundInput: EveAgentProvisioningInput = {
    ...resolvedInput,
    project: {
      kind: "existing",
      projectId: project.id,
      projectName: project.name,
    },
  };
  reportProgress(span, onProgress, {
    phase: "uploading",
    logs: [
      {
        source: "status",
        text: "Uploading the Eve agent to Vercel…",
      },
    ],
  });
  reportProgress(span, onProgress, {
    phase: "deploying",
    logs: [
      {
        source: "status",
        text: "Creating the Vercel deployment…",
      },
    ],
  });
  const deployment = await requestJson({
    fetcher,
    token,
    url: vercelUrl("/v13/deployments", {
      teamId: resolvedInput.teamId,
      skipAutoDetectionConfirmation: "1",
    }),
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        deploymentRequestBody(boundInput, files, gitMetadata),
      ),
    },
    schema: deploymentSchema,
  });
  if (deployment.projectId !== project.id) {
    throw new Error(
      "Vercel returned a deployment for a different project. Chief stopped before changing project settings.",
    );
  }
  const buildStartedAt = Date.now();
  reportProgress(
    span,
    onProgress,
    deploymentProgress("configuring", deployment, {
      buildStartedAt,
      logs: [
        {
          source: "status",
          text: "Writing Chief channel environment on the Vercel project…",
        },
      ],
    }),
  );
  await persistEnvironment({
    environment: resolvedInput.environment,
    fetcher,
    projectId: deployment.projectId,
    teamId: resolvedInput.teamId,
    token,
  });
  await disableEveDeploymentProtection({
    fetcher,
    projectId: deployment.projectId,
    teamId: resolvedInput.teamId,
    token,
  });

  reportProgress(
    span,
    onProgress,
    deploymentProgress("waiting", deployment, { buildStartedAt }),
  );
  const ready = await waitForDeployment({
    buildStartedAt,
    deploymentId: deployment.id,
    expectedProjectId: project.id,
    fetcher,
    maxWaitMs,
    onProgress: (progress) => reportProgress(span, onProgress, progress),
    pollIntervalMs,
    teamId: resolvedInput.teamId,
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
    buildStartedAt,
  };
  if (ready.inspectorUrl) checking.inspectorUrl = ready.inspectorUrl;
  reportProgress(span, onProgress, checking);
  await confirmProjectEnvironment({
    fetcher,
    projectId: ready.projectId,
    teamId: resolvedInput.teamId,
    token,
  });
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
  files: readonly EveProjectFile[],
  gitMetadata: {
    remoteUrl: string;
    commitSha: string;
    commitRef: string;
    commitMessage: string;
    commitAuthorName: string;
    dirty: boolean;
  },
) {
  const body = {
    name: input.project.projectName,
    files: files.map((file) => ({
      file: file.path,
      encoding: "base64",
      data: textToBase64(file.contents),
    })),
    target: "production",
    env: input.environment,
    gitMetadata,
    projectSettings: {
      framework: "eve",
      buildCommand: "npm run build",
      installCommand: "npm install",
      nodeVersion: "24.x",
    },
  };
  if (input.project.kind === "existing") {
    Object.assign(body, { project: input.project.projectId });
  }
  return body;
}

async function vercelGitMetadata(
  input: EveAgentProvisioningInput,
  files: readonly EveProjectFile[],
  git?: { remoteUrl: string; commitSha?: string },
) {
  const repository = await buildGitRepository(
    files.map((file): GitFile => ({ path: file.path, content: file.contents })),
  );
  return {
    remoteUrl:
      git?.remoteUrl ??
      chiefGitRemoteUrl(
        input.environment.CHIEF_RELAY_URL,
        input.environment.CHIEF_WORKSPACE_ID,
        chiefGitRepoSlug(input.project.projectName),
      ),
    commitSha: git?.commitSha ?? repository.commitSha,
    commitRef: "main",
    commitMessage: "Publish Eve agent from Chief",
    commitAuthorName: "Chief",
    dirty: false,
  };
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

function textToBase64(contents: string) {
  const bytes = new TextEncoder().encode(contents);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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

async function disableEveDeploymentProtection({
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
  await requestJson({
    fetcher,
    token,
    url: vercelUrl(`/v9/projects/${encodeURIComponent(projectId)}`, { teamId }),
    init: {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ssoProtection: null }),
    },
    schema: unknownSchema,
  }).catch(() => undefined);
}

async function confirmProjectEnvironment({
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
  const body = await requestJson({
    fetcher,
    token,
    url: vercelUrl(`/v10/projects/${encodeURIComponent(projectId)}/env`, {
      teamId,
    }),
    schema: unknownSchema,
  });
  const keys = parseEnvironmentKeys(body);
  if (keys.length === 0) return;
  const missing = environmentKeys.filter((key) => !keys.includes(key));
  if (missing.length > 0) {
    throw new Error(
      `Vercel did not store ${missing.join(", ")} on this Eve project.`,
    );
  }
}

function assertChiefChannelPackaged(files: readonly EveProjectFile[]) {
  const channel = files.find((file) => file.path === "agent/channels/chief.ts");
  if (!channel) {
    throw new Error("The Eve package is missing the Chief messaging channel.");
  }
  if (
    !channel.contents.includes('POST<ChiefState>("/channels/chief/messages"')
  ) {
    throw new Error(
      "The Eve package does not include the Chief messaging route.",
    );
  }
  const requiredKeys = [
    "CHIEF_AGENT_ID",
    "CHIEF_CHANNEL_TOKEN",
    "CHIEF_RELAY_URL",
    "CHIEF_WORKSPACE_ID",
  ] as const;
  for (const key of requiredKeys) {
    if (!channel.contents.includes(key)) {
      throw new Error(
        `The Eve package does not read ${key} for the Chief channel.`,
      );
    }
  }
}

function parseEnvironmentKeys(body: unknown) {
  const parsed = environmentKeysSchema.safeParse(body);
  if (!parsed.success) return [];
  const rows = Array.isArray(parsed.data) ? parsed.data : parsed.data.envs;
  return rows.map((row) => row.key);
}
