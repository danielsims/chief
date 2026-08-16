import type { ClientMessage } from "../client-message.js";
import type { ExecutorCapability, ServerMessage } from "../types.js";
import type { ProjectGitService } from "./git-service.js";

type ProjectClientMessage = Extract<
  ClientMessage,
  {
    type:
      | "listProjects"
      | "attachProject"
      | "cloneProject"
      | "browseProject"
      | "inspectProjectCommit";
  }
>;

function isProjectClientMessage(
  message: ClientMessage,
): message is ProjectClientMessage {
  return new Set([
    "listProjects",
    "attachProject",
    "cloneProject",
    "browseProject",
    "inspectProjectCommit",
  ]).has(message.type);
}

export async function handleProjectClientMessage(
  message: ClientMessage,
  input: {
    service: ProjectGitService;
    authorize: (
      workspaceId: string,
      capability: ExecutorCapability,
    ) => Promise<void>;
    send: (message: ServerMessage) => void;
    broadcast: (workspaceId: string) => Promise<void>;
  },
) {
  if (!isProjectClientMessage(message)) return false;
  const { service, send } = input;
  await input.authorize(message.workspaceId, message.executorCapability);
  const principal = await service.operatorPrincipal(message.workspaceId);
  if (message.type === "listProjects") {
    send({
      type: "projects",
      workspaceId: message.workspaceId,
      projects: await service.list(message.workspaceId, principal),
    });
    return true;
  }
  if (message.type === "browseProject") {
    send({
      type: "projectBrowser",
      workspaceId: message.workspaceId,
      requestId: message.requestId,
      browser: await service.browse(
        message.workspaceId,
        message.projectId,
        principal,
        message.ref,
        message.path,
      ),
    });
    return true;
  }
  if (message.type === "inspectProjectCommit") {
    send({
      type: "projectCommit",
      workspaceId: message.workspaceId,
      requestId: message.requestId,
      detail: await service.inspectCommit(
        message.workspaceId,
        message.projectId,
        principal,
        message.ref,
        message.commit,
      ),
    });
    return true;
  }
  const project =
    message.type === "attachProject"
      ? await service.attach(message.workspaceId, message.path, principal, {
          ...(message.name ? { name: message.name } : {}),
          ...(message.description ? { description: message.description } : {}),
        })
      : await service.clone(message.workspaceId, message.remoteUrl, principal, {
          ...(message.name ? { name: message.name } : {}),
          ...(message.description ? { description: message.description } : {}),
        });
  send({
    type: "projectSaved",
    workspaceId: message.workspaceId,
    requestId: message.requestId,
    project,
  });
  await input.broadcast(message.workspaceId);
  return true;
}
