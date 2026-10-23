import { Predicate } from "effect";
import { z } from "zod";

import type { WebMachineFetchResult } from "@chief/relay-contracts";
import {
  agentIdSchema,
  isJsonString,
  parseJsonObject,
  webMachineFetchResultSchema,
  webMachinePolicyMessageSchema,
  webMachinePolicySchema,
  webMachineRateLimits,
} from "@chief/relay-contracts";

import type { WorkspaceChannelStore } from "./workspace-channel-store";
import { HttpError, json } from "./http";
import { readTrustedContext } from "./internal-context";
import { requireNativeAgent, workspaceAgent } from "./workspace-agent-runtime";

/**
 * A member's desktop lends this workspace's agents its internet connection.
 * It connects out to here, so nothing on the member's network is opened up,
 * and fetches public pages on request from its own IP. Only this workspace's
 * agents can use it, and only those its owner's policy admits.
 */
export const webMachineTag = "web-machine";

const answerWithinMs = 30_000;
// WebSocket.OPEN, which the Workers runtime doesn't define as a static.
const openSocket = 1;
const pending = new Map<string, (result: WebMachineFetchResult) => void>();

const webMachineAttachmentSchema = z.object({
  ownerUserId: z.string(),
  /** Set for a paired machine; a member's desktop has none. */
  machineId: z.string().optional(),
  policy: webMachinePolicySchema,
  /** Recent fetches, oldest first, for the machine's rate limits. */
  servedAt: z.array(z.number()).optional(),
});

type WebMachineAttachment = z.infer<typeof webMachineAttachmentSchema>;

export function acceptWebMachine(
  ctx: DurableObjectState,
  owner: { ownerUserId: string; machineId?: string },
) {
  const pair = new WebSocketPair();
  ctx.acceptWebSocket(pair[1], [webMachineTag]);
  // Until the machine says otherwise, only its owner's agents may use it.
  pair[1].serializeAttachment({
    ...owner,
    policy: { allow: "mine" },
  } satisfies WebMachineAttachment);
  return new Response(null, { status: 101, webSocket: pair[0] });
}

/** Paired machines with a lending socket open right now. */
export function onlineMachineIds(ctx: DurableObjectState) {
  return new Set(
    ctx
      .getWebSockets(webMachineTag)
      .flatMap((socket) => machineAttachment(socket).machineId ?? []),
  );
}

/** Closes a removed machine's socket, so it stops serving at once. */
export function disconnectMachine(ctx: DurableObjectState, machineId: string) {
  for (const socket of ctx.getWebSockets(webMachineTag))
    if (machineAttachment(socket).machineId === machineId)
      socket.close(1008, "Machine removed");
}

export function isWebMachine(ctx: DurableObjectState, socket: WebSocket) {
  return ctx.getTags(socket).includes(webMachineTag);
}

function machineAttachment(socket: WebSocket) {
  return webMachineAttachmentSchema.parse(socket.deserializeAttachment());
}

/** An agent's owner; built-in agents belong to the workspace's creator. */
function agentOwner(storage: DurableObjectStorage, agentId: string) {
  try {
    return workspaceAgent(storage, agentId).ownerUserId;
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404) throw error;
    return requireNativeAgent(storage, agentId).ownerUserId;
  }
}

/** Whether a machine's owner lets this agent, for this person, use it. */
function admits(
  machine: WebMachineAttachment,
  agentId: string,
  agentOwnerId: string,
  requesterUserId: string | undefined,
) {
  const { policy } = machine;
  // The owner's own agents can always use their machine.
  if (agentOwnerId === machine.ownerUserId) return true;
  if (policy.allow === "workspace") return true;
  if (policy.allow === "mine") return false;
  // A person's grant covers their own agents and agents working for them.
  return policy.grants.some(
    (grant) =>
      (grant.userId === agentOwnerId || grant.userId === requesterUserId) &&
      (grant.agentIds === "all" ||
        grant.agentIds.some((allowed) => allowed === agentId)),
  );
}

/** Whether the machine is within its rate limits, counting this fetch. */
function withinLimits(socket: WebSocket, now: number) {
  const machine = machineAttachment(socket);
  const lastHour = (machine.servedAt ?? []).filter(
    (at) => now - at < 60 * 60_000,
  );
  const lastMinute = lastHour.filter((at) => now - at < 60_000);
  if (
    lastMinute.length >= webMachineRateLimits.perMinute ||
    lastHour.length >= webMachineRateLimits.perHour
  )
    return false;
  socket.serializeAttachment({
    ...machine,
    servedAt: [...lastHour, now],
  } satisfies WebMachineAttachment);
  return true;
}

export function receiveWebMachineMessage(socket: WebSocket, message: string) {
  if (message === "ping") {
    socket.send("pong");
    return;
  }
  let data: unknown;
  try {
    data = JSON.parse(message);
  } catch {
    socket.close(1008, "Invalid machine message");
    return;
  }
  if (Predicate.isObject(data) && data.type === "web.machine.policy") {
    // A policy this relay doesn't understand, such as one from an older
    // app, leaves the machine serving only its owner's agents.
    const policy = webMachinePolicyMessageSchema.safeParse(data);
    socket.serializeAttachment({
      ...machineAttachment(socket),
      policy: policy.success ? policy.data.policy : { allow: "mine" },
    } satisfies WebMachineAttachment);
    return;
  }
  const result = webMachineFetchResultSchema.safeParse(data);
  if (!result.success) {
    socket.close(1008, "Invalid machine message");
    return;
  }
  pending.get(result.data.requestId)?.(result.data);
}

/**
 * Fetches a public page through a connected machine whose owner lets the
 * calling agent use it. Only an agent of this workspace can ask.
 */
export async function fetchThroughWebMachine(
  ctx: DurableObjectState,
  channels: WorkspaceChannelStore,
  request: Request,
) {
  const { principal, workspaceId } = readTrustedContext(request);
  if (principal.kind !== "agent")
    throw new HttpError(403, "agents_only", "Only agents can use a machine.");
  const agentId = agentIdSchema.parse(principal.agentId);
  const input = parseJsonObject(await request.json());
  const url = input?.url;
  const requesterUserId = isJsonString(input?.requesterUserId)
    ? input.requesterUserId
    : undefined;
  if (!isJsonString(url))
    return json({ error: "invalid_url" }, { status: 400 });
  const agentOwnerId =
    agentOwner(ctx.storage, agentId) ??
    String(channels.requireWorkspace(workspaceId).created_by_user_id);
  // The most recently connected machine is the one most likely awake; one
  // that's used up its allowance is passed over for the next.
  const now = Date.now();
  const socket = ctx
    .getWebSockets(webMachineTag)
    .filter(
      (candidate) =>
        candidate.readyState === openSocket &&
        admits(
          machineAttachment(candidate),
          agentId,
          agentOwnerId,
          requesterUserId,
        ),
    )
    .reverse()
    .find((candidate) => withinLimits(candidate, now));
  if (!socket) return json({ error: "no_machine" }, { status: 404 });
  const requestId = crypto.randomUUID();
  const result = await new Promise<WebMachineFetchResult | undefined>(
    (resolve) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        resolve(undefined);
      }, answerWithinMs);
      pending.set(requestId, (answer) => {
        clearTimeout(timer);
        pending.delete(requestId);
        resolve(answer);
      });
      socket.send(
        JSON.stringify({
          type: "web.fetch",
          requestId,
          url,
          agentId,
          ...(requesterUserId ? { requesterUserId } : undefined),
        }),
      );
    },
  );
  if (!result) return json({ error: "machine_timeout" }, { status: 504 });
  return json(result);
}
