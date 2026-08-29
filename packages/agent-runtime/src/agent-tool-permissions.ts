import {
  agentApiOperationForRequest,
  channelApiOperations,
  scheduledWorkApiOperations,
} from "@chief/channel-api";
import {
  pluginApiOperationForRequest,
  pluginApiOperations,
} from "@chief/plugin-api";

import type { AgentToolPermission } from "./types.js";

export interface AgentToolPermissionDefinition {
  id: AgentToolPermission;
  label: string;
  description: string;
  group:
    | "Workspace"
    | "Projects"
    | "Machines"
    | "Channels"
    | "Messages"
    | "Scheduled work"
    | "Advanced";
}

export const agentToolPermissionDefinitions: readonly AgentToolPermissionDefinition[] =
  [
    {
      id: "workspace.read",
      label: "Read workspace data",
      description: "Read files, research, analytics and saved work.",
      group: "Workspace",
    },
    {
      id: "workspace.write",
      label: "Save workspace data",
      description: "Create or update files, research and content.",
      group: "Workspace",
    },
    {
      id: "projects.read",
      label: "Inspect projects",
      description: "Read repository status, branches, commits and checkouts.",
      group: "Projects",
    },
    {
      id: "projects.write",
      label: "Work in projects",
      description: "Create isolated checkouts and commit agent changes.",
      group: "Projects",
    },
    {
      id: "machines.read",
      label: "View machines",
      description: "See the machines connected to this workspace.",
      group: "Machines",
    },
    {
      id: "machines.write",
      label: "Manage machines",
      description: "Connect machines and assign agent access.",
      group: "Machines",
    },
    {
      id: "channels.read",
      label: "View channels",
      description: "Discover channels and read their activity.",
      group: "Channels",
    },
    {
      id: "channels.create",
      label: "Create channels",
      description: "Create standard and feature channels.",
      group: "Channels",
    },
    {
      id: "channels.update",
      label: "Edit channels",
      description: "Update channel details and workstream state.",
      group: "Channels",
    },
    {
      id: "channels.archive",
      label: "Archive channels",
      description: "Archive, restore or request permanent deletion.",
      group: "Channels",
    },
    {
      id: "members.read",
      label: "View members",
      description: "See the people and agents in a channel.",
      group: "Channels",
    },
    {
      id: "members.manage",
      label: "Manage members",
      description: "Invite, remove, join or leave channels.",
      group: "Channels",
    },
    {
      id: "messages.read",
      label: "Read messages",
      description: "Read and search channel conversations.",
      group: "Messages",
    },
    {
      id: "messages.send",
      label: "Send messages",
      description: "Post replies and add reactions.",
      group: "Messages",
    },
    {
      id: "messages.manage",
      label: "Manage own messages",
      description: "Edit or delete messages created by this agent.",
      group: "Messages",
    },
    {
      id: "schedules.read",
      label: "View scheduled work",
      description: "Inspect schedules, runs and trigger history.",
      group: "Scheduled work",
    },
    {
      id: "schedules.manage",
      label: "Manage scheduled work",
      description: "Create, update, pause or remove schedules.",
      group: "Scheduled work",
    },
    {
      id: "schedules.run",
      label: "Run scheduled work",
      description: "Start, retry or cancel scheduled runs.",
      group: "Scheduled work",
    },
    {
      id: "webhooks.manage",
      label: "Manage webhook triggers",
      description: "View and rotate local webhook credentials.",
      group: "Scheduled work",
    },
    {
      id: "browser.use",
      label: "Use the browser",
      description: "Open and operate visible browser sessions.",
      group: "Advanced",
    },
    {
      id: "integrations.manage",
      label: "Manage connections",
      description: "Open setup flows and save connection credentials.",
      group: "Advanced",
    },
    {
      id: "agents.delegate",
      label: "Delegate to agents",
      description: "Start private specialist work.",
      group: "Advanced",
    },
  ] as const;

export const allAgentToolPermissions = agentToolPermissionDefinitions.map(
  (permission) => permission.id,
);

function emptyPermissionOperations(
  permission: AgentToolPermission,
): [AgentToolPermission, string[]] {
  return [permission, []];
}

const executorOperationsByPermissionMutable = new Map(
  allAgentToolPermissions.map(emptyPermissionOperations),
);

for (const operation of [
  ...channelApiOperations,
  ...scheduledWorkApiOperations,
  ...pluginApiOperations,
]) {
  if (!operation.toolPermission) continue;
  const operations = executorOperationsByPermissionMutable.get(
    operation.toolPermission,
  );
  if (!operations) {
    throw new Error(
      `Unknown agent tool permission: ${operation.toolPermission}`,
    );
  }
  operations.push(operation.operationId);
}

/**
 * Channel and scheduled-work policy names come directly from the shared API
 * reference, so docs, OpenAPI, Executor, and request authorization cannot
 * silently acquire separate hand-maintained vocabularies.
 */
export const executorOperationsByPermission: ReadonlyMap<
  AgentToolPermission,
  readonly string[]
> = executorOperationsByPermissionMutable;

function executorOperationName(operationId: string) {
  const [first = "", ...rest] = operationId.split(".");
  return `${first}${rest.map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join("")}`;
}

const permissionByExecutorTool = new Map<string, AgentToolPermission>(
  [...executorOperationsByPermission].flatMap(([permission, operations]) =>
    operations.map((operation) =>
      permissionToolNames(
        permission,
        `localTools.${executorOperationName(operation)}`,
      ),
    ),
  ),
);

function permissionToolNames(
  permission: AgentToolPermission,
  name: string,
): [string, AgentToolPermission] {
  return [name, permission];
}

const executorToolPermissionGroups: readonly (readonly [
  AgentToolPermission,
  readonly string[],
])[] = [
  [
    "workspace.read",
    [
      "prospectsList",
      "trendsList",
      "analyticsListDatasets",
      "contentList",
      "filesList",
      "filesRead",
      "campaignsList",
      "recurringWorkList",
    ],
  ],
  [
    "workspace.write",
    [
      "prospectsSave",
      "trendsSave",
      "analyticsSaveDataset",
      "contentSave",
      "filesWrite",
      "campaignsSave",
      "actionRaise",
      "brandProfileSave",
      "recurringWorkPropose",
    ],
  ],
  [
    "projects.read",
    ["projectsList", "projectsInspect", "projectsCheckoutStatus"],
  ],
  [
    "projects.write",
    ["projectsCreateCheckout", "projectsCommit", "projectsReleaseCheckout"],
  ],
  [
    "browser.use",
    [
      "browserOpen",
      "browserSnapshot",
      "browserClose",
      "browserPresent",
      "browserClick",
      "browserFill",
      "browserSelect",
      "browserPress",
    ],
  ],
  [
    "integrations.manage",
    [
      "googleOAuthProvisionClient",
      "googleOAuthCaptureClient",
      "googleAnalyticsAuthorize",
      "googleAnalyticsComplete",
      "googleAnalyticsSelect",
      "integrationOpenHandoff",
      "integrationCaptureGeneratedCredential",
      "integrationOpenProviderPage",
      "setupList",
      "setupStart",
    ],
  ],
  ["agents.delegate", ["specialistsDelegate"]],
];

for (const [permission, names] of executorToolPermissionGroups) {
  for (const name of names)
    permissionByExecutorTool.set(`localTools.${name}`, permission);
}

export function permissionForExecutorTool(name: string) {
  return permissionByExecutorTool.get(name);
}

/**
 * Executor owns the workspace-wide tool ceiling. Chief's per-agent/session
 * checks can narrow this further, but they never turn an Executor block into
 * an allow.
 */
export function executorPermissionPolicyAction(
  name: string,
  permissionCeiling: ReadonlySet<AgentToolPermission>,
): "approve" | "block" | undefined {
  const permission = permissionForExecutorTool(name);
  if (!permission) return undefined;
  return permissionCeiling.has(permission) ? "approve" : "block";
}

const standardAgentPermissions = allAgentToolPermissions.filter(
  (permission) => permission !== "agents.delegate",
);

export function defaultAgentToolPermissions(
  agentId: string,
): AgentToolPermission[] {
  return agentId === "chief" || agentId === "setup"
    ? [...allAgentToolPermissions]
    : [...standardAgentPermissions];
}

export function effectiveAgentToolPermissions(
  agentId: string,
  configured?: readonly AgentToolPermission[],
): AgentToolPermission[] {
  return configured
    ? [...new Set(configured)]
    : defaultAgentToolPermissions(agentId);
}

/**
 * Build Executor's workspace policy ceiling from the agents that may run in
 * that workspace. An empty union deliberately means no agent tool access; it
 * must never be interpreted as an unset policy or expanded to every tool.
 */
export function combinedAgentToolPermissionCeiling(
  agents: readonly {
    agentId: string;
    enabled: boolean;
    toolPermissions?: readonly AgentToolPermission[];
  }[],
): AgentToolPermission[] {
  return [
    ...new Set(
      agents
        .filter((agent) => agent.enabled)
        .flatMap((agent) =>
          effectiveAgentToolPermissions(agent.agentId, agent.toolPermissions),
        ),
    ),
  ];
}

const exactLocalToolPermissions = new Map<string, AgentToolPermission>([
  ...[
    "/local-tools/prospects",
    "/local-tools/trends",
    "/local-tools/analytics/datasets",
    "/local-tools/content",
    "/local-tools/files",
    "/local-tools/campaigns",
    "/local-tools/brand-profile",
    "/local-tools/recurring-work",
  ].map((path) => [`GET ${path}`, "workspace.read"] as const),
  ["POST /local-tools/files/read", "workspace.read"],
  ...[
    "/local-tools/prospects",
    "/local-tools/trends",
    "/local-tools/analytics/datasets",
    "/local-tools/content",
    "/local-tools/files/write",
    "/local-tools/campaigns",
    "/local-tools/brand-profile",
    "/local-tools/recurring-work",
    "/local-tools/action",
  ].map((path) => [`POST ${path}`, "workspace.write"] as const),
  ["GET /local-tools/projects", "projects.read"],
  ...[
    "/local-tools/projects/inspect",
    "/local-tools/projects/checkouts/status",
    "/local-tools/projects/diff",
    "/local-tools/projects/pull-requests/status",
    "/local-tools/projects/access-request",
  ].map((path) => [`POST ${path}`, "projects.read"] as const),
  ...[
    "/local-tools/projects/checkouts",
    "/local-tools/projects/checkouts/commit",
    "/local-tools/projects/checkouts/release",
    "/local-tools/projects/checkouts/publish",
    "/local-tools/projects/checkouts/discard",
    "/local-tools/projects/pull-requests",
  ].map((path) => [`POST ${path}`, "projects.write"] as const),
  ...[
    "open",
    "close",
    "present",
    "snapshot",
    "press",
    "click",
    "fill",
    "select",
  ].map(
    (operation) =>
      [`POST /local-tools/browser/${operation}`, "browser.use"] as const,
  ),
  ...[
    "/local-tools/integrations/google-oauth/provision-client",
    "/local-tools/integrations/google-oauth/capture-client",
    "/local-tools/integrations/google-analytics/authorize",
    "/local-tools/integrations/google-analytics/complete",
    "/local-tools/integrations/google-analytics/select",
    "/local-tools/integrations/handoff/open",
    "/local-tools/integrations/credential/capture",
    "/local-tools/integrations/provider/open",
    "/local-tools/setup/list",
    "/local-tools/setup/start",
  ].map((path) => [`POST ${path}`, "integrations.manage"] as const),
  ["POST /local-tools/specialists/delegate", "agents.delegate"],
]);

export function permissionForLocalTool(
  method: string,
  pathname: string,
): AgentToolPermission | undefined {
  const verb = method.toUpperCase();
  const apiOperation = agentApiOperationForRequest(verb, pathname);
  if (apiOperation?.toolPermission) return apiOperation.toolPermission;
  const pluginOperation = pluginApiOperationForRequest(verb, pathname);
  if (pluginOperation?.toolPermission) return pluginOperation.toolPermission;
  return exactLocalToolPermissions.get(`${verb} ${pathname}`);
}
