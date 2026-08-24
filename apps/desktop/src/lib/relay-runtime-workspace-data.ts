import type {
  ClientMessage,
  PluginAuthorizationAction,
  ProjectRecord,
  ProjectRepositorySnapshot,
  ServerMessage,
  WorkspaceFileRecord,
  WorkspaceFileSnapshot,
} from "@chief/agent-runtime/types";
import type { RelayClient } from "@chief/relay-client";
import type {
  RelayProject,
  WorkspaceFile,
  WorkspaceSnapshot,
} from "@chief/relay-contracts";

import { requestDesktopPluginHost } from "./desktop-plugin-host";

type PluginSnapshot = Omit<
  Extract<ServerMessage, { type: "plugins" }>,
  "type" | "workspaceId"
>;

interface WorkspaceDataContext {
  relay: RelayClient;
  snapshot: WorkspaceSnapshot;
  emit(message: ServerMessage): void;
}

export async function routeRelayWorkspaceDataCommand(
  message: ClientMessage,
  context: WorkspaceDataContext,
) {
  switch (message.type) {
    case "listWorkspaceFiles":
      await listWorkspaceFiles(context);
      return true;
    case "getWorkspaceFile":
      await getWorkspaceFile(context, message.fileId, message.requestId);
      return true;
    case "saveWorkspaceFile":
      await saveWorkspaceFile(context, message);
      return true;
    case "listProjects":
      await listProjects(context);
      return true;
    case "cloneProject":
      await registerClonedProject(context, message);
      return true;
    case "attachProject":
      throw new Error(
        "Choose a Git remote for this relay-backed project. Local repository paths stay private to this Mac.",
      );
    case "listPlugins": {
      const { snapshot } = await requestDesktopPluginHost<{
        snapshot: PluginSnapshot;
      }>("/plugins/list", {
        workspaceId: context.snapshot.id,
        refresh: message.refresh === true,
      });
      context.emit({
        type: "plugins",
        workspaceId: context.snapshot.id,
        ...snapshot,
      });
      return true;
    }
    case "installPlugin": {
      const { snapshot } = await requestDesktopPluginHost<{
        snapshot: PluginSnapshot;
      }>("/plugins/install", {
        workspaceId: context.snapshot.id,
        pluginId: message.pluginId,
        trusted: message.trusted,
      });
      context.emit({
        type: "plugins",
        workspaceId: context.snapshot.id,
        ...snapshot,
      });
      return true;
    }
    case "authorizePlugin": {
      const { action, snapshot } = await requestDesktopPluginHost<{
        action:
          PluginAuthorizationAction | { pluginId: string; status: "connected" };
        snapshot: PluginSnapshot;
      }>("/plugins/authorize", {
        workspaceId: context.snapshot.id,
        pluginId: message.pluginId,
      });
      context.emit({
        type: "plugins",
        workspaceId: context.snapshot.id,
        ...snapshot,
      });
      if (action.status !== "connected") {
        context.emit({
          type: "pluginAuthorization",
          workspaceId: context.snapshot.id,
          requestId: message.requestId,
          action,
        });
      }
      return true;
    }
    case "uninstallPlugin": {
      const { snapshot } = await requestDesktopPluginHost<{
        snapshot: PluginSnapshot;
      }>("/plugins/uninstall", {
        workspaceId: context.snapshot.id,
        pluginId: message.pluginId,
      });
      context.emit({
        type: "plugins",
        workspaceId: context.snapshot.id,
        ...snapshot,
      });
      return true;
    }
    case "listWorkspaceData":
      await listWorkspaceData(context);
      return true;
    default:
      return false;
  }
}

async function listWorkspaceFiles(context: WorkspaceDataContext) {
  const files = await context.relay.listWorkspaceFiles();
  context.emit({
    type: "workspaceFiles",
    workspaceId: context.snapshot.id,
    files: files.map(toWorkspaceFileRecord),
  });
}

async function getWorkspaceFile(
  context: WorkspaceDataContext,
  fileId: string,
  requestId: string,
) {
  const file = (await context.relay.listWorkspaceFiles()).find(
    (candidate) => candidate.id === fileId,
  );
  if (!file) throw new Error("File not found.");
  context.emit({
    type: "workspaceFile",
    workspaceId: context.snapshot.id,
    file: toWorkspaceFileSnapshot(file),
    requestId,
  });
}

async function saveWorkspaceFile(
  context: WorkspaceDataContext,
  message: Extract<ClientMessage, { type: "saveWorkspaceFile" }>,
) {
  if (!message.file.id || !message.file.expectedVersionId) {
    throw new Error(
      "Relay files must already exist before they can be edited.",
    );
  }
  const expectedVersion = Number(message.file.expectedVersionId);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error("The file revision is invalid.");
  }
  const file = await context.relay.updateWorkspaceFile(message.file.id, {
    title: message.file.name,
    content: message.file.content,
    expectedVersion,
  });
  context.emit({
    type: "workspaceFileSaved",
    workspaceId: context.snapshot.id,
    file: toWorkspaceFileSnapshot(file),
    requestId: message.requestId,
  });
  await listWorkspaceFiles(context);
}

async function listProjects(context: WorkspaceDataContext) {
  const projects = await context.relay.listProjects();
  context.emit({
    type: "projects",
    workspaceId: context.snapshot.id,
    projects: projects.map(toProjectSnapshot),
  });
}

async function registerClonedProject(
  context: WorkspaceDataContext,
  message: Extract<ClientMessage, { type: "cloneProject" }>,
) {
  const repository = projectRepositoryDetails(message.remoteUrl);
  const requestedName = message.name?.trim();
  const project = await context.relay.createProject({
    name: requestedName?.length ? requestedName : repository.name,
    ...(message.description?.trim()
      ? { description: message.description.trim() }
      : {}),
    repositoryKind: "cloned",
    providerId: repository.providerId,
    canonicalRemoteUrl: repository.canonicalRemoteUrl,
    ...(repository.repositoryWebUrl
      ? { repositoryWebUrl: repository.repositoryWebUrl }
      : {}),
    defaultBranch: "main",
  });
  context.emit({
    type: "projectSaved",
    workspaceId: context.snapshot.id,
    requestId: message.requestId,
    project: toProjectRecord(project),
  });
  await listProjects(context);
}

async function listWorkspaceData(context: WorkspaceDataContext) {
  const prospects = await context.relay.listProspects();
  context.emit({
    type: "workspaceData",
    workspaceId: context.snapshot.id,
    revision: Date.now(),
    prospects: prospects.map((prospect) => ({
      id: prospect.id,
      name: prospect.name,
      ...(prospect.company ? { company: prospect.company } : {}),
      source: prospect.source,
      sourceUrl: prospect.sourceUrl,
      summary: prospect.summary,
      relevance: prospect.relevance,
      status: prospect.status === "reviewing" ? "researching" : prospect.status,
      foundAt: Date.parse(prospect.foundAt),
    })),
    trends: [],
    analyticsDatasets: [],
    drafts: [],
    campaigns: [],
    recurringWork: [],
    activity: [],
    actionItems: [],
    waysOfWorking: {
      mode: "mission-control",
      missionControlChannelId: "mission-control",
      updatedAt: 0,
    },
  });
}

function toProjectRecord(project: RelayProject): ProjectRecord {
  return {
    ...project,
    createdAt: Date.parse(project.createdAt),
    updatedAt: Date.parse(project.updatedAt),
  };
}

function toProjectSnapshot(project: RelayProject): ProjectRepositorySnapshot {
  const record = toProjectRecord(project);
  return {
    project: record,
    portable: Boolean(record.canonicalRemoteUrl),
    available: false,
    branches: [record.defaultBranch],
    commits: [],
    checkouts: [],
    error:
      "This project is registered on the relay. Materialize it in an agent cell to inspect or change its files.",
  };
}

function projectRepositoryDetails(raw: string): {
  name: string;
  providerId: RelayProject["providerId"];
  canonicalRemoteUrl: string;
  repositoryWebUrl?: string;
} {
  const value = raw.trim();
  const scp = /^git@([^:]+):(.+)$/u.exec(value);
  const normalized = scp ? `ssh://${scp[1]}/${scp[2]}` : value;
  const url = new URL(normalized);
  if (
    !["https:", "ssh:"].includes(url.protocol) ||
    (url.username && url.protocol === "https:")
  ) {
    throw new Error(
      "Use an HTTPS or SSH Git remote without embedded credentials.",
    );
  }
  const path = url.pathname.replace(/^\//u, "").replace(/\.git$/iu, "");
  const name = path.split("/").filter(Boolean).at(-1) ?? "Project";
  const hostname = url.hostname.toLowerCase();
  const providerId =
    hostname === "github.com"
      ? "github"
      : hostname === "gitlab.com"
        ? "gitlab"
        : hostname === "bitbucket.org"
          ? "bitbucket"
          : "generic-git";
  return {
    name,
    providerId,
    canonicalRemoteUrl: scp ? value : url.toString(),
    ...(["github", "gitlab", "bitbucket"].includes(providerId)
      ? { repositoryWebUrl: `https://${hostname}/${path}` }
      : {}),
  };
}

function toWorkspaceFileRecord(file: WorkspaceFile): WorkspaceFileRecord {
  return {
    id: file.id,
    name: file.title,
    path: file.path,
    mimeType: file.mimeType,
    kind: file.mimeType === "message/rfc822" ? "email" : "document",
    provider: "local",
    currentVersionId: String(file.version),
    createdBy: "agent",
    sourceAgentId: file.authorAgentId,
    createdAt: Date.parse(file.createdAt),
    updatedAt: Date.parse(file.updatedAt),
  };
}

function toWorkspaceFileSnapshot(file: WorkspaceFile): WorkspaceFileSnapshot {
  return { ...toWorkspaceFileRecord(file), content: file.content };
}
