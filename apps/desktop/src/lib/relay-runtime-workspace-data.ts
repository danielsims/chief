import type {
  ClientMessage,
  ServerMessage,
  WorkspaceFileRecord,
  WorkspaceFileSnapshot,
} from "@chief/agent-runtime/types";
import type { RelayClient } from "@chief/relay-client";
import type { WorkspaceFile, WorkspaceSnapshot } from "@chief/relay-contracts";

import type { ProjectGitHubAccess } from "./relay-runtime-project-connect";
import type { RuntimeCommand } from "./runtime-transport";
import {
  relayProjectRecord,
  relayProjectSnapshot,
} from "./relay-project-presentation";
import { routeRelayPluginCommand } from "./relay-runtime-plugins";
import {
  connectRelayProject,
  localProjectSnapshots,
  queryRelayProject,
} from "./relay-runtime-project-connect";
import { routeRelayScheduleCommand } from "./relay-runtime-schedules";
import { loadRelayWorkspaceActivity } from "./relay-workspace-activity";

interface WorkspaceDataContext {
  relay: Pick<
    RelayClient,
    | "plugins"
    | "schedules"
    | "createProject"
    | "listAgentJobs"
    | "listProjects"
    | "listWorkspaceFiles"
    | "updateWorkspaceFile"
  > &
    ProjectGitHubAccess;
  snapshot: WorkspaceSnapshot;
  emit(message: ServerMessage): void;
}

const workspaceDataCommandTypes = [
  "saveRecurringWork",
  "runRecurringWorkNow",
  "deleteRecurringWork",
  "listWorkspaceFiles",
  "getWorkspaceFile",
  "saveWorkspaceFile",
  "listProjects",
  "browseProject",
  "inspectProjectCommit",
  "compareProjectBranches",
  "cloneProject",
  "attachProject",
  "listPlugins",
  "installPlugin",
  "authorizePlugin",
  "uninstallPlugin",
  "listWorkspaceData",
] as const satisfies readonly RuntimeCommand["type"][];

type RelayWorkspaceDataCommand = Extract<
  RuntimeCommand,
  { type: (typeof workspaceDataCommandTypes)[number] }
>;

export function isRelayWorkspaceDataCommand(
  message: RuntimeCommand,
): message is RelayWorkspaceDataCommand {
  const types: readonly string[] = workspaceDataCommandTypes;
  return types.includes(message.type);
}

export async function routeRelayWorkspaceDataCommand(
  message: RelayWorkspaceDataCommand,
  context: WorkspaceDataContext,
) {
  if (
    message.type === "saveRecurringWork" ||
    message.type === "runRecurringWorkNow" ||
    message.type === "deleteRecurringWork"
  ) {
    try {
      await routeRelayScheduleCommand(message, context.relay);
    } finally {
      await listWorkspaceData(context);
    }
    return;
  }
  switch (message.type) {
    case "listWorkspaceFiles":
      await listWorkspaceFiles(context);
      return;
    case "getWorkspaceFile":
      await getWorkspaceFile(context, message.fileId, message.requestId);
      return;
    case "saveWorkspaceFile":
      await saveWorkspaceFile(context, message);
      return;
    case "listProjects":
      await listProjects(context);
      return;
    case "browseProject":
    case "inspectProjectCommit":
    case "compareProjectBranches":
      context.emit(await queryRelayProject(context.snapshot.id, message));
      return;
    case "cloneProject":
    case "attachProject": {
      const project = await connectRelayProject(
        context.relay,
        context.snapshot.id,
        message,
      );
      context.emit({
        type: "projectSaved",
        workspaceId: context.snapshot.id,
        requestId: message.requestId,
        project: relayProjectRecord(project),
      });
      await listProjects(context);
      return;
    }
    case "listPlugins":
    case "installPlugin":
    case "authorizePlugin":
    case "uninstallPlugin":
      await routeRelayPluginCommand(message, {
        relay: context.relay,
        workspaceId: context.snapshot.id,
        emit: (event) => context.emit(event),
      });
      return;
    case "listWorkspaceData":
      await listWorkspaceData(context);
      return;
    default: {
      const unhandled: never = message;
      return unhandled;
    }
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
    projects: await localProjectSnapshots(
      context.snapshot.id,
      projects.map(relayProjectSnapshot),
    ),
  });
}

async function listWorkspaceData(context: WorkspaceDataContext) {
  const [schedules, activity] = await Promise.all([
    context.relay.schedules.list(),
    loadRelayWorkspaceActivity(context.relay, context.snapshot),
  ]);
  context.emit({
    type: "workspaceData",
    workspaceId: context.snapshot.id,
    revision: Date.now(),
    trends: [],
    analyticsDatasets: [],
    drafts: [],
    campaigns: [],
    recurringWork: schedules,
    activity,
    actionItems: [],
    waysOfWorking: {
      mode: "mission-control",
      missionControlChannelId: "mission-control",
      updatedAt: 0,
    },
  });
}

function toWorkspaceFileRecord(file: WorkspaceFile): WorkspaceFileRecord {
  return {
    id: file.id,
    name: file.title,
    previewContent: file.asset
      ? undefined
      : file.mimeType === "text/html"
        ? file.content
        : file.content.slice(0, 2400),
    path: file.path,
    mimeType: file.mimeType,
    kind: file.mimeType === "message/rfc822" ? "email" : "document",
    provider: "relay",
    ...(file.asset ? { asset: file.asset } : undefined),
    sourceConversationId: file.conversationId,
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
