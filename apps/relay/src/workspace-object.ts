import { DurableObject } from "cloudflare:workers";

import { HttpError, relayError } from "./http";
import { readTrustedContext, readTrustedIdentity } from "./internal-context";
import { WorkspaceAccessService } from "./workspace-access-service";
import {
  routeWorkspaceChannel,
  routeWorkspaceDirect,
} from "./workspace-channel-router";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import { routeWorkspaceData } from "./workspace-data-store";
import { WorkspaceInvitationService } from "./workspace-invitation-service";
import { WorkspaceLifecycleService } from "./workspace-lifecycle-service";
import { WorkspaceLogService } from "./workspace-log-service";
import { initializeWorkspaceSchema } from "./workspace-schema";

export class WorkspaceObject extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    void state.blockConcurrencyWhile(() => {
      initializeWorkspaceSchema(state.storage, env);
      return Promise.resolve();
    });
  }

  async fetch(request: Request) {
    try {
      if (request.method !== "POST") {
        return relayError(405, "method_not_allowed", "Method not allowed.");
      }
      const operation = request.headers.get("x-chief-internal-operation");
      const response = await this.routeOperation(request, operation);
      return (
        response ??
        relayError(404, "not_found", "Workspace operation not found.")
      );
    } catch (error) {
      if (error instanceof HttpError) {
        return relayError(error.status, error.code, error.message);
      }
      return relayError(
        400,
        "invalid_request",
        "The workspace request is invalid.",
      );
    }
  }

  private async routeOperation(request: Request, operation: string | null) {
    if (operation?.startsWith("channels-")) {
      return routeWorkspaceChannel(
        this.ctx.storage,
        this.env,
        request,
        operation,
      );
    }
    if (operation === "directs-start") {
      return routeWorkspaceDirect(this.ctx.storage, this.env, request);
    }
    if (operation?.startsWith("data-")) {
      return this.routeData(request, operation);
    }

    const access = new WorkspaceAccessService(this.ctx.storage, this.env);
    if (operation === "members-list") return access.membersList(request);
    if (operation === "member-role-set") return access.memberRoleSet(request);
    if (operation === "agent-config-get") return access.agentConfigGet(request);
    if (operation === "agent-config-set") {
      return access.agentConfigSet(request);
    }
    if (operation === "authorize-conversation") {
      return access.authorizeConversation(request);
    }
    if (operation === "authorize-agent-runtime") {
      return access.authorizeAgentRuntime(request);
    }
    if (operation === "register-agent-key") {
      return access.registerAgentKey(request, readTrustedIdentity(request));
    }
    if (operation === "agent-keys") return access.agentKeys();

    const invitations = new WorkspaceInvitationService(
      this.ctx.storage,
      this.env,
    );
    if (operation === "invite-create") {
      return invitations.create(request, readTrustedContext(request).principal);
    }
    if (operation === "invite-preview") return invitations.preview(request);
    if (operation === "invite-claim") {
      return invitations.claim(request, readTrustedIdentity(request).identity);
    }

    const lifecycle = new WorkspaceLifecycleService(this.ctx.storage, this.env);
    if (operation === "complete-onboarding") {
      return lifecycle.completeOnboarding(request);
    }
    const context = readTrustedIdentity(request);
    if (operation === "authorize") return access.authorize(context.identity);
    if (operation === "claim") return lifecycle.claim(request, context);
    if (operation === "create-managed") {
      return lifecycle.createManaged(request, context);
    }
    if (operation === "snapshot") return lifecycle.snapshot(context);
    if (operation === "deletion-plan") return lifecycle.deletionPlan(context);
    if (operation === "delete-owned") return lifecycle.deleteOwned(context);

    const logs = new WorkspaceLogService(this.ctx.storage, this.env);
    if (operation === "record-logs") return logs.record(request);
    if (operation === "list-logs") return logs.list(request);
    return undefined;
  }

  private async routeData(request: Request, operation: string) {
    const context = readTrustedContext(request);
    const channels = new WorkspaceChannelStore(this.ctx.storage, this.env);
    channels.requirePrincipalMember(context.principal);
    channels.requireAgentCapability(
      context.principal,
      workspaceDataCapability(operation),
    );
    return routeWorkspaceData(
      this.ctx.storage,
      request,
      operation,
      context.principal,
    );
  }
}

function workspaceDataCapability(operation: string) {
  if (operation === "data-brand-save" || operation === "data-prospect-save") {
    return "workspace.write";
  }
  return "workspace.read";
}
