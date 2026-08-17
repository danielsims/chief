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
      | "inspectProjectCommit"
      | "compareProjectBranches"
      | "publishProjectCheckout"
      | "discardProjectCheckout"
      | "createProjectPullRequest"
      | "listProjectAccessRequests"
      | "resolveProjectAccessRequest";
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
    "compareProjectBranches",
    "publishProjectCheckout",
    "discardProjectCheckout",
    "createProjectPullRequest",
    "listProjectAccessRequests",
    "resolveProjectAccessRequest",
  ]).has(message.type);
}

/** Current project state sent to every connected client in one workspace. */
export async function projectWorkspaceSnapshotMessages(
  service: ProjectGitService,
  workspaceId: string,
): Promise<ServerMessage[]> {
  const operator = await service.operatorPrincipal(workspaceId);
  const [projects, requests] = await Promise.all([
    service.list(workspaceId, operator),
    service.administration.pendingAccessRequests(workspaceId, operator),
  ]);
  return [
    { type: "projects", workspaceId, projects },
    { type: "projectAccessRequests", workspaceId, requests },
  ];
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
  if (message.type === "compareProjectBranches") {
    send({
      type: "projectComparison",
      workspaceId: message.workspaceId,
      requestId: message.requestId,
      comparison: await service.compare(
        message.workspaceId,
        message.projectId,
        principal,
        message.baseRef,
        message.compareRef,
      ),
    });
    return true;
  }
  if (message.type === "publishProjectCheckout") {
    const result = await service.checkouts.publish(
      message.workspaceId,
      message.checkoutId,
      principal,
      {
        ...(message.targetBranch ? { targetBranch: message.targetBranch } : {}),
        ...(message.correlationId
          ? { correlationId: message.correlationId }
          : {}),
        ...(message.allowDefaultBranch
          ? { allowDefaultBranch: message.allowDefaultBranch }
          : {}),
      },
    );
    send({
      type: "projectPublished",
      workspaceId: message.workspaceId,
      requestId: message.requestId,
      checkoutId: result.checkoutId,
      branch: result.branch,
      head: result.head,
    });
    await input.broadcast(message.workspaceId);
    return true;
  }
  if (message.type === "discardProjectCheckout") {
    await service.checkouts.discard(
      message.workspaceId,
      message.checkoutId,
      principal,
      { confirmed: message.confirmed },
    );
    send({
      type: "projectCheckoutDiscarded",
      workspaceId: message.workspaceId,
      requestId: message.requestId,
      checkoutId: message.checkoutId,
    });
    await input.broadcast(message.workspaceId);
    return true;
  }
  if (message.type === "createProjectPullRequest") {
    const pullRequest = await service.createPullRequest(
      message.workspaceId,
      message.projectId,
      principal,
      {
        title: message.title,
        ...(message.description ? { description: message.description } : {}),
        headBranch: message.headBranch,
        baseBranch: message.baseBranch,
      },
    );
    send({
      type: "projectPullRequestCreated",
      workspaceId: message.workspaceId,
      requestId: message.requestId,
      pullRequest,
    });
    return true;
  }
  if (message.type === "listProjectAccessRequests") {
    send({
      type: "projectAccessRequests",
      workspaceId: message.workspaceId,
      requests: await service.administration.pendingAccessRequests(
        message.workspaceId,
        principal,
      ),
    });
    return true;
  }
  if (message.type === "resolveProjectAccessRequest") {
    const request =
      message.decision === "approved"
        ? await service.administration.approveProjectAccess(
            message.workspaceId,
            message.accessRequestId,
            principal,
          )
        : await service.administration.denyProjectAccess(
            message.workspaceId,
            message.accessRequestId,
            principal,
          );
    void request;
    send({
      type: "projectAccessRequestResolved",
      workspaceId: message.workspaceId,
      requestId: message.requestId,
    });
    await input.broadcast(message.workspaceId);
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
