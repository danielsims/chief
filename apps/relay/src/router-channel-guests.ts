import { z } from "zod";

import type { Principal, WorkspaceId } from "@chief/relay-contracts";
import {
  conversationIdSchema,
  guestIdSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import {
  GUEST_CREDENTIAL_HEADER,
  guestTokenFrom,
} from "./channel-guest-crypto";
import { handleGuestMcp } from "./channel-guest-mcp";
import {
  channelLinkMissingResponse,
  channelLinkResponse,
  memberChannelResponse,
} from "./channel-guest-page";
import {
  GUEST_GATEWAY_SERVICE,
  PUBLIC_ORIGIN_HEADER,
} from "./channel-guest-shared";
import { HttpError, relayError } from "./http";
import { withTrustedContext } from "./internal-context";
import { publicOrigin } from "./relay-discovery";
import { authenticateRelayRequest } from "./router-auth";
import { authorizeWorkspace } from "./workspace-authority";

/** Members' link to an internal channel: opens Chief, admits no one. */
const memberLinkRoute = /^\/open\/channel\/([^/]+)$/u;
/** A member's invite for their own agent. */
const inviteRoute = /^\/agents\/([^/]+)\/([A-Za-z0-9_-]{32})(\/join)?$/u;
const guestRoute =
  /^\/v1\/workspaces\/([^/]+)\/guest(\/messages(?:\/([^/]+)\/thread)?|\/delivery|\/listen|\/mcp(?:\/([^/]+))?)?$/u;
const memberRoute =
  /^\/v1\/workspaces\/([^/]+)\/channels\/([^/]+)\/(guests|guests\/invite|guests\/([^/]+)\/remove)$/u;

const inviteResolutionSchema = z.object({
  workspace: z.object({ id: z.string(), name: z.string() }),
  channel: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
  }),
  invitedBy: z.string(),
});

/**
 * Agent invites and the agent API. Invited agents authenticate with their own
 * bearer credential, never with a workspace identity; members create invites
 * and remove agents with signed requests.
 */
export async function routeChannelGuestRequest(
  env: Env,
  request: Request,
  requestId: string,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const origin = publicOrigin(request, url, env);

  const memberLink = memberLinkRoute.exec(url.pathname);
  if (memberLink) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return methodNotAllowed(requestId);
    }
    const conversationId = conversationIdSchema.safeParse(
      decodeURIComponent(memberLink[1] ?? ""),
    );
    if (!conversationId.success) return channelLinkMissingResponse(request);
    return memberChannelResponse(request, conversationId.data);
  }

  const invite = inviteRoute.exec(url.pathname);
  if (invite) {
    const workspaceId = workspaceIdSchema.safeParse(
      decodeURIComponent(invite[1] ?? ""),
    );
    if (!workspaceId.success) return channelLinkMissingResponse(request);
    const token = invite[2] ?? "";
    if (invite[3]) {
      if (request.method !== "POST") return methodNotAllowed(requestId);
      await requireAllowance(env, request);
      return gateway(env, workspaceId.data, "guest-join", requestId, {
        origin,
        search: { token },
        body: await request.text(),
      });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return methodNotAllowed(requestId);
    }
    await requireAllowance(env, request);
    const resolved = await gateway(
      env,
      workspaceId.data,
      "guest-invite-resolve",
      requestId,
      { origin, search: { token } },
    );
    if (!resolved.ok) {
      await resolved.body?.cancel();
      return channelLinkMissingResponse(request);
    }
    const view = inviteResolutionSchema.parse(await resolved.json());
    const link = `${origin}/agents/${encodeURIComponent(workspaceId.data)}/${token}`;
    return channelLinkResponse(request, {
      origin,
      link,
      joinUrl: `${link}/join`,
      invitedBy: view.invitedBy,
      workspaceId: workspaceId.data,
      workspaceName: view.workspace.name,
      channel: view.channel,
    });
  }

  const guest = guestRoute.exec(url.pathname);
  if (guest) {
    const workspaceId = workspaceIdSchema.parse(
      decodeURIComponent(guest[1] ?? ""),
    );
    const suffix = guest[2] ?? "";
    const pathToken = guest[4] ? decodeURIComponent(guest[4]) : null;
    const credential =
      guestTokenFrom(pathToken) ??
      guestTokenFrom(request.headers.get("authorization"));
    if (!credential) {
      return relayError(
        401,
        "guest_unauthorized",
        "Send your guest token as `Authorization: Bearer <token>`.",
        requestId,
        undefined,
        { "www-authenticate": 'Bearer realm="chief-guest"' },
      );
    }
    const call = (
      operation: string,
      input: { search?: Record<string, string>; body?: unknown },
    ) =>
      gateway(env, workspaceId, operation, requestId, {
        origin,
        credential,
        ...(input.search ? { search: input.search } : undefined),
        ...(input.body === undefined
          ? undefined
          : { body: JSON.stringify(input.body) }),
      });
    // Every guest call reaches the workspace object; cap each credential.
    await requireAllowance(env, request, `guest:${credential.slice(4, 24)}`);
    if (suffix.startsWith("/mcp")) return handleGuestMcp(request, call);
    const operation = guestOperation(request.method, suffix, guest[3]);
    if (!operation) return methodNotAllowed(requestId);
    const search = Object.fromEntries(url.searchParams);
    if (guest[3]) search.messageId = decodeURIComponent(guest[3]);
    return gateway(env, workspaceId, operation, requestId, {
      origin,
      credential,
      search,
      ...(request.method === "POST" || request.method === "PUT"
        ? { body: await request.text() }
        : undefined),
    });
  }

  const member = memberRoute.exec(url.pathname);
  if (member) {
    const workspaceId = workspaceIdSchema.parse(
      decodeURIComponent(member[1] ?? ""),
    );
    const conversationId = conversationIdSchema.parse(
      decodeURIComponent(member[2] ?? ""),
    );
    const operation = memberOperation(request.method, member[3] ?? "");
    if (!operation) return methodNotAllowed(requestId);
    const authenticated = await authenticateRelayRequest(request, env);
    const principal = await authorizeWorkspace(env, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
    return forward(env, workspaceId, operation, requestId, principal, {
      origin,
      search: {
        conversationId,
        ...(member[4]
          ? { guestId: guestIdSchema.parse(decodeURIComponent(member[4])) }
          : undefined),
      },
      // Authentication already read the body to verify its signature.
      ...(request.method === "PUT"
        ? { body: await authenticated.request.text() }
        : undefined),
    });
  }
  return undefined;
}

function memberOperation(method: string, action: string) {
  if (action === "guests") return method === "GET" ? "guest-list" : undefined;
  if (action === "guests/invite") {
    return method === "POST" ? "guest-invite-create" : undefined;
  }
  return method === "POST" ? "guest-remove" : undefined;
}

function guestOperation(
  method: string,
  suffix: string,
  messageId: string | undefined,
) {
  if (suffix === "") {
    if (method === "GET") return "guest-me";
    if (method === "DELETE") return "guest-leave";
    return undefined;
  }
  if (suffix === "/listen")
    return method === "POST" ? "guest-listen" : undefined;
  if (suffix === "/delivery") {
    return method === "PUT" || method === "POST" ? "guest-delivery" : undefined;
  }
  if (messageId) return method === "GET" ? "guest-thread" : undefined;
  if (method === "GET") return "guest-messages";
  if (method === "POST") return "guest-post";
  return undefined;
}

function gateway(
  env: Env,
  workspaceId: WorkspaceId,
  operation: string,
  requestId: string,
  input: {
    origin: string;
    search?: Record<string, string>;
    body?: string;
    credential?: string;
  },
) {
  return forward(
    env,
    workspaceId,
    operation,
    requestId,
    { kind: "service", service: GUEST_GATEWAY_SERVICE, workspaceId },
    input,
  );
}

function forward(
  env: Env,
  workspaceId: WorkspaceId,
  operation: string,
  requestId: string,
  principal: Principal,
  input: {
    origin: string;
    search?: Record<string, string>;
    body?: string;
    credential?: string;
  },
) {
  const url = new URL("https://workspace.internal/guests");
  for (const [name, value] of Object.entries(input.search ?? {})) {
    url.searchParams.set(name, value);
  }
  const headers = new Headers({
    "content-type": "application/json",
    "x-chief-internal-operation": operation,
    [PUBLIC_ORIGIN_HEADER]: input.origin,
  });
  if (input.credential) {
    headers.set(GUEST_CREDENTIAL_HEADER, input.credential);
  }
  return env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
    withTrustedContext(
      new Request(url, { method: "POST", headers, body: input.body ?? "{}" }),
      { principal, requestId, workspaceId },
    ),
  );
}

async function requireAllowance(env: Env, request: Request, scope?: string) {
  const key =
    scope ?? request.headers.get("cf-connecting-ip") ?? "unknown-edge";
  const { success } = await env.AUTH_REQUEST_RATE_LIMITER.limit({ key });
  if (!success) {
    throw new HttpError(
      429,
      "rate_limit_exceeded",
      "Too many requests. Try again shortly.",
    );
  }
}

function methodNotAllowed(requestId: string) {
  return relayError(
    405,
    "method_not_allowed",
    "Method not allowed.",
    requestId,
  );
}
