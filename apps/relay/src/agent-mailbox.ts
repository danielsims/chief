import type { JsonObject, Principal } from "@chief/relay-contracts";
import {
  parseJsonObject,
  principalSchema,
  socketTicketSchema,
} from "@chief/relay-contracts";

import type { readTrustedContext } from "./internal-context";
import { requireAgentPrincipal } from "./agent-job-store";
import { HttpError, json, relayError } from "./http";
import {
  readTrustedAgentSocketTicket,
  withTrustedContext,
} from "./internal-context";
import { releaseInternalResponse } from "./internal-response";
import { consumeSocketTicket, createSocketTicket } from "./socket-ticket-store";
import { reportAgentHost } from "./workspace-presence";
import { workspaceStub } from "./workspace-stubs";

export async function createAgentMailboxSocketTicket(
  storage: DurableObjectStorage,
  request: Request,
  context: ReturnType<typeof readTrustedContext>,
) {
  requireAgentPrincipal(context.principal);
  const agentId = new URL(request.url).searchParams.get("agentId");
  if (agentId !== context.principal.agentId) {
    throw new HttpError(
      403,
      "agent_mailbox_access_denied",
      "An agent can only subscribe to its own mailbox.",
    );
  }
  return json(
    socketTicketSchema.parse(
      await createSocketTicket(storage, context.principal),
    ),
    { status: 201 },
  );
}

export async function connectAgentMailboxWebSocket(
  state: DurableObjectState,
  env: Env,
  request: Request,
) {
  const context = readTrustedAgentSocketTicket(request);
  const principalJson = await consumeSocketTicket(
    state.storage,
    context.ticket,
  );
  if (!principalJson) {
    return relayError(
      401,
      "invalid_socket_ticket",
      "The socket ticket is invalid or expired.",
    );
  }
  const principal = principalSchema.parse(JSON.parse(principalJson));
  if (principal.kind !== "agent" || principal.agentId !== context.agentId) {
    return relayError(
      403,
      "agent_mailbox_access_denied",
      "The socket ticket does not belong to this agent.",
    );
  }
  if (!(await currentAgentIdentity(env, principal))) {
    return relayError(
      403,
      "agent_revoked",
      "This agent identity no longer has access.",
    );
  }
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.serializeAttachment({ principal });
  state.acceptWebSocket(server);
  state.waitUntil(reportAgentHost(env, principal, true));
  return new Response(null, { status: 101, webSocket: client });
}

async function currentAgentIdentity(env: Env, principal: Principal) {
  if (principal.kind !== "agent") return false;
  const response = await workspaceStub(env, principal.workspaceId).fetch(
    withTrustedContext(
      new Request("https://workspace.internal", {
        method: "POST",
        headers: { "x-chief-internal-operation": "authorize-agent-runtime" },
      }),
      {
        principal,
        workspaceId: principal.workspaceId,
        requestId: crypto.randomUUID(),
      },
    ),
  );
  const authorized = response.ok;
  await releaseInternalResponse(response);
  return authorized;
}

/** Revalidate saved socket identities, including tickets issued before rotation. */
export async function deliverAgentMailboxSocketEvent(
  env: Env,
  sockets: readonly Pick<
    WebSocket,
    "send" | "close" | "deserializeAttachment"
  >[],
  event: JsonObject,
) {
  const serialized = JSON.stringify(event);
  await Promise.all(
    sockets.map(async (socket) => {
      try {
        const principal = principalSchema.parse(
          parseJsonObject(socket.deserializeAttachment())?.principal,
        );
        if (!(await currentAgentIdentity(env, principal))) {
          socket.close(1008, "Agent identity revoked");
          return;
        }
        socket.send(serialized);
      } catch {
        socket.close(1008, "Agent access must be renewed");
      }
    }),
  );
}

/** The host is offline once its last mailbox socket is gone. */
export async function closeAgentMailboxWebSocket(
  state: DurableObjectState,
  env: Env,
  socket: WebSocket,
) {
  const principal = principalSchema.safeParse(
    parseJsonObject(socket.deserializeAttachment())?.principal,
  );
  if (!principal.success || principal.data.kind !== "agent") return;
  if (state.getWebSockets().some((peer) => peer !== socket)) return;
  await reportAgentHost(env, principal.data, false);
}
