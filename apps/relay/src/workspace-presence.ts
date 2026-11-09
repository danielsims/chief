import type {
  AgentPrincipal,
  ConversationMessage,
} from "@chief/relay-contracts";
import { agentHostPresenceSchema } from "@chief/relay-contracts";

import type { WorkspaceSocketAttachment } from "./workspace-socket-state";
import { isGuestListener } from "./channel-guest-listeners";
import { HttpError, parseJson } from "./http";
import { readTrustedContext, withTrustedContext } from "./internal-context";
import { releaseInternalResponse } from "./internal-response";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import { workspaceSocketAttachment } from "./workspace-socket-state";
import { isWebMachine } from "./workspace-web-machine";

const agentHostPrefix = "agent-host:";
const agentErrorPrefix = "agent-error:";
const agentPlacementOperations = new Set([
  "agent-create",
  "agent-config-set",
  "agent-remove",
]);

/**
 * Who is connected, fanned out to the people on the workspace socket. People
 * are online while a subscribed socket of theirs is open; a device-hosted
 * agent is online while its host holds the agent's mailbox open.
 */
export class WorkspacePresence {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  /** A socket just subscribed. Announce a newcomer, or catch this socket up. */
  async subscribed(socket: WebSocket, previous: WorkspaceSocketAttachment) {
    const principal = previous.principal;
    // Later subscribes only change conversations; the socket is caught up.
    if (principal.kind !== "user" || previous.subscribed) return;
    const arrived = !this.peopleSockets(socket).some(
      ({ attachment }) =>
        attachment.principal.kind === "user" &&
        attachment.principal.userId === principal.userId,
    );
    if (arrived) await this.broadcast();
    else this.send(socket, await this.event());
  }

  /** A socket closed. Announce it if that was the person's last one. */
  async closed(socket: WebSocket) {
    if (isGuestListener(this.ctx, socket) || isWebMachine(this.ctx, socket))
      return;
    let attachment: WorkspaceSocketAttachment;
    try {
      attachment = workspaceSocketAttachment(socket);
    } catch {
      return;
    }
    const principal = attachment.principal;
    if (principal.kind !== "user" || !attachment.subscribed) return;
    const stillHere = this.peopleSockets(socket).some(
      (peer) =>
        peer.attachment.principal.kind === "user" &&
        peer.attachment.principal.userId === principal.userId,
    );
    if (!stillHere) await this.broadcast(socket);
  }

  /** An agent's relay object reporting whether its host holds the mailbox. */
  async receiveHostReport(request: Request) {
    const { principal } = readTrustedContext(request);
    if (principal.kind !== "agent")
      throw new HttpError(
        403,
        "agent_required",
        "Only an agent's mailbox reports its host.",
      );
    const { online } = agentHostPresenceSchema.parse(await parseJson(request));
    await this.agentHost(principal.agentId, online);
    return new Response(null, { status: 204 });
  }

  /** Where an agent runs decides whether it shows as online. */
  afterAccess(operation: string | null, response: Response) {
    if (response.ok && agentPlacementOperations.has(operation ?? ""))
      this.ctx.waitUntil(this.broadcast());
  }

  /** An agent's host connected or disconnected its mailbox. */
  async agentHost(agentId: string, online: boolean) {
    const key = `${agentHostPrefix}${agentId}`;
    const was = (await this.ctx.storage.get<boolean>(key)) === true;
    if (was === online) return;
    if (online) await this.ctx.storage.put(key, true);
    else await this.ctx.storage.delete(key);
    await this.broadcast();
  }

  /**
   * An agent's activity row: a failed run marks the agent errored until it
   * starts its next run. Being offline is shown by its own dot, not as an error.
   */
  async agentActivity(message: ConversationMessage) {
    if (message.author.kind !== "agent") return;
    const failed = message.components.some(
      (component) =>
        component.kind === "error" &&
        component.payload.code !== "agent_host_offline",
    );
    const started = message.components.some(
      (component) =>
        component.kind === "agent.activity" &&
        component.payload.status === "working",
    );
    if (!failed && !started) return;
    const key = `${agentErrorPrefix}${message.author.id}`;
    const was = (await this.ctx.storage.get<boolean>(key)) === true;
    if (was === failed) return;
    if (failed) await this.ctx.storage.put(key, true);
    else await this.ctx.storage.delete(key);
    await this.broadcast();
  }

  private async event() {
    const hosted = await this.ctx.storage.list<boolean>({
      prefix: agentHostPrefix,
    });
    const channels = new WorkspaceChannelStore(this.ctx.storage, this.env);
    const offlineAgentIds = channels
      .workspaceAgentIds()
      .filter(
        (agentId) =>
          channels.agentConfiguration(agentId).deploymentTarget !== "cloud" &&
          !hosted.has(`${agentHostPrefix}${agentId}`),
      );
    const errored = await this.ctx.storage.list<boolean>({
      prefix: agentErrorPrefix,
    });
    const userIds = new Set<string>();
    for (const { attachment } of this.peopleSockets()) {
      if (attachment.principal.kind === "user")
        userIds.add(attachment.principal.userId);
    }
    return JSON.stringify({
      type: "workspace.presence",
      userIds: [...userIds],
      offlineAgentIds,
      erroredAgentIds: [...errored.keys()].map((key) =>
        key.slice(agentErrorPrefix.length),
      ),
    });
  }

  /** Sends everyone the current presence, e.g. after an agent moves host. */
  async broadcast(except?: WebSocket) {
    const event = await this.event();
    for (const { socket } of this.peopleSockets(except))
      this.send(socket, event);
  }

  private send(socket: WebSocket, event: string) {
    try {
      socket.send(event);
    } catch {
      // Presence is best-effort; real deliveries handle a bad socket.
    }
  }

  /** Subscribed sockets of people, never guests, agents or lending machines. */
  private peopleSockets(except?: WebSocket) {
    const sockets: {
      socket: WebSocket;
      attachment: WorkspaceSocketAttachment;
    }[] = [];
    for (const socket of this.ctx.getWebSockets()) {
      if (
        socket === except ||
        isGuestListener(this.ctx, socket) ||
        isWebMachine(this.ctx, socket)
      )
        continue;
      try {
        const attachment = workspaceSocketAttachment(socket);
        if (attachment.subscribed && attachment.principal.kind === "user")
          sockets.push({ socket, attachment });
      } catch {
        // A socket without a workspace attachment isn't a member's feed.
      }
    }
    return sockets;
  }
}

/** Tells an agent's workspace whether its host holds the mailbox open. */
export async function reportAgentHost(
  env: Env,
  principal: AgentPrincipal,
  online: boolean,
) {
  const response = await env.WORKSPACES.get(
    env.WORKSPACES.idFromName(principal.workspaceId),
  ).fetch(
    withTrustedContext(
      new Request("https://workspace.internal", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chief-internal-operation": "agent-host-presence",
        },
        body: JSON.stringify(agentHostPresenceSchema.parse({ online })),
      }),
      {
        principal,
        workspaceId: principal.workspaceId,
        requestId: crypto.randomUUID(),
      },
    ),
  );
  await releaseInternalResponse(response);
}
