import type {
  AuthenticatedIdentity,
  Principal,
  WorkspaceId,
} from "@chief/relay-contracts";
import {
  agentIdSchema,
  authenticatedIdentitySchema,
  principalSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

const identityHeader = "x-chief-trusted-identity";
const principalHeader = "x-chief-trusted-principal";
const requestIdHeader = "x-chief-request-id";
const workspaceHeader = "x-chief-workspace-id";
const conversationHeader = "x-chief-conversation-id";
const socketTicketHeader = "x-chief-trusted-socket-ticket";
const agentHeader = "x-chief-agent-id";

export function withTrustedAccountIdentity(
  identity: AuthenticatedIdentity,
  init?: RequestInit,
) {
  const headers = new Headers(init?.headers);
  headers.set(identityHeader, JSON.stringify(identity));
  return new Request("https://account.internal", { ...init, headers });
}

export function readTrustedAccountIdentity(request: Request) {
  const identityValue = request.headers.get(identityHeader);
  if (!identityValue) throw new Error("Missing trusted account identity.");
  return authenticatedIdentitySchema.parse(JSON.parse(identityValue));
}

export function withTrustedContext(
  request: Request,
  input: {
    principal: Principal;
    requestId: string;
    workspaceId: WorkspaceId;
    conversationId?: string;
  },
) {
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.set(principalHeader, JSON.stringify(input.principal));
  headers.set(requestIdHeader, input.requestId);
  headers.set(workspaceHeader, input.workspaceId);
  if (input.conversationId)
    headers.set(conversationHeader, input.conversationId);
  return new Request(request, { headers });
}

export function readTrustedContext(request: Request) {
  const principalValue = request.headers.get(principalHeader);
  const requestId = request.headers.get(requestIdHeader);
  const workspaceId = request.headers.get(workspaceHeader);
  const conversationId = request.headers.get(conversationHeader);
  if (!principalValue || !requestId || !workspaceId) {
    throw new Error("Missing trusted relay context.");
  }
  return {
    principal: principalSchema.parse(JSON.parse(principalValue)),
    requestId,
    workspaceId: workspaceIdSchema.parse(workspaceId),
    conversationId,
  };
}

export function requiredTrustedConversationId(
  context: ReturnType<typeof readTrustedContext>,
) {
  if (!context.conversationId) throw new Error("Missing conversation context.");
  return context.conversationId;
}

export function withTrustedIdentity(
  input: {
    identity: AuthenticatedIdentity;
    requestId: string;
    workspaceId: WorkspaceId;
  },
  init?: RequestInit,
) {
  const headers = new Headers(init?.headers);
  headers.set(identityHeader, JSON.stringify(input.identity));
  headers.set(requestIdHeader, input.requestId);
  headers.set(workspaceHeader, input.workspaceId);
  return new Request("https://workspace.internal", { ...init, headers });
}

export function readTrustedIdentity(request: Request) {
  const identityValue = request.headers.get(identityHeader);
  const requestId = request.headers.get(requestIdHeader);
  const workspaceId = request.headers.get(workspaceHeader);
  if (!identityValue || !requestId || !workspaceId) {
    throw new Error("Missing trusted relay identity.");
  }
  return {
    identity: authenticatedIdentitySchema.parse(JSON.parse(identityValue)),
    requestId,
    workspaceId: workspaceIdSchema.parse(workspaceId),
  };
}

export function withTrustedSocketTicket(
  request: Request,
  input: {
    ticket: string;
    requestId: string;
    workspaceId: WorkspaceId;
    conversationId: string;
  },
) {
  const headers = new Headers();
  headers.set("upgrade", "websocket");
  headers.set(socketTicketHeader, input.ticket);
  headers.set(requestIdHeader, input.requestId);
  headers.set(workspaceHeader, input.workspaceId);
  headers.set(conversationHeader, input.conversationId);
  return new Request(request.url, { method: "GET", headers });
}

export function readTrustedSocketTicket(request: Request) {
  const ticket = request.headers.get(socketTicketHeader);
  const requestId = request.headers.get(requestIdHeader);
  const workspaceId = request.headers.get(workspaceHeader);
  const conversationId = request.headers.get(conversationHeader);
  if (!ticket || !requestId || !workspaceId || !conversationId) {
    throw new Error("Missing trusted socket ticket.");
  }
  return {
    ticket,
    requestId,
    workspaceId: workspaceIdSchema.parse(workspaceId),
    conversationId,
  };
}

export function withTrustedWorkspaceSocketTicket(
  request: Request,
  input: {
    ticket: string;
    requestId: string;
    workspaceId: WorkspaceId;
  },
) {
  const headers = new Headers();
  headers.set("upgrade", "websocket");
  headers.set(socketTicketHeader, input.ticket);
  headers.set(requestIdHeader, input.requestId);
  headers.set(workspaceHeader, input.workspaceId);
  return new Request(request.url, { method: "GET", headers });
}

export function readTrustedWorkspaceSocketTicket(request: Request) {
  const ticket = request.headers.get(socketTicketHeader);
  const requestId = request.headers.get(requestIdHeader);
  const workspaceId = request.headers.get(workspaceHeader);
  if (!ticket || !requestId || !workspaceId) {
    throw new Error("Missing trusted workspace socket ticket.");
  }
  return {
    ticket,
    requestId,
    workspaceId: workspaceIdSchema.parse(workspaceId),
  };
}

export function withTrustedAgentSocketTicket(
  request: Request,
  input: {
    ticket: string;
    requestId: string;
    workspaceId: WorkspaceId;
    agentId: string;
  },
) {
  const headers = new Headers();
  headers.set("upgrade", "websocket");
  headers.set(socketTicketHeader, input.ticket);
  headers.set(requestIdHeader, input.requestId);
  headers.set(workspaceHeader, input.workspaceId);
  headers.set(agentHeader, input.agentId);
  return new Request(request.url, { method: "GET", headers });
}

export function readTrustedAgentSocketTicket(request: Request) {
  const ticket = request.headers.get(socketTicketHeader);
  const requestId = request.headers.get(requestIdHeader);
  const workspaceId = request.headers.get(workspaceHeader);
  const agentId = request.headers.get(agentHeader);
  if (!ticket || !requestId || !workspaceId || !agentId) {
    throw new Error("Missing trusted agent socket ticket.");
  }
  return {
    ticket,
    requestId,
    workspaceId: workspaceIdSchema.parse(workspaceId),
    agentId: agentIdSchema.parse(agentId),
  };
}
