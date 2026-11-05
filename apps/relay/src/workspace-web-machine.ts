import { Predicate } from "effect";
import { z } from "zod";

import type {
  MachineBrowserResult,
  WebMachineFetchResult,
} from "@chief/relay-contracts";
import {
  agentIdSchema,
  isJsonString,
  machineBrowserCommandSchema,
  machineBrowserResultSchema,
  parseJsonObject,
  webMachineFetchResultSchema,
  webMachinePolicyMessageSchema,
  webMachinePolicySchema,
  webMachineRateLimits,
} from "@chief/relay-contracts";

import type { WorkspaceChannelStore } from "./workspace-channel-store";
import { HttpError, json } from "./http";
import { readTrustedContext } from "./internal-context";
import { requireNativeAgent } from "./workspace-agent-runtime";

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
export type MachineSocket = Pick<
  WebSocket,
  | "readyState"
  | "deserializeAttachment"
  | "serializeAttachment"
  | "send"
  | "close"
>;
type MachineResult = WebMachineFetchResult | MachineBrowserResult;
const pending = new Map<
  string,
  { socket: MachineSocket; resolve: (result: MachineResult) => void }
>();

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

function machineAttachment(socket: MachineSocket) {
  return webMachineAttachmentSchema.parse(socket.deserializeAttachment());
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
function withinLimits(socket: MachineSocket, now: number) {
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

export function receiveWebMachineMessage(
  socket: MachineSocket,
  message: string,
) {
  if (message === "ping") {
    socket.send("pong");
    return;
  }
  if (message.length > 2_900_000) {
    socket.close(1009, "Machine message too large");
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
  const result = z
    .union([webMachineFetchResultSchema, machineBrowserResultSchema])
    .safeParse(data);
  if (!result.success) {
    socket.close(1008, "Invalid machine message");
    return;
  }
  const waiting = pending.get(result.data.requestId);
  if (waiting?.socket === socket) waiting.resolve(result.data);
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
  if (principal.kind !== "agent" || principal.workspaceId !== workspaceId)
    throw new HttpError(403, "agents_only", "Only agents can use a machine.");
  channels.requirePrincipalMember(principal);
  const agent = requireNativeAgent(ctx.storage, principal.agentId);
  const agentId = agentIdSchema.parse(principal.agentId);
  const input = parseJsonObject(await request.json());
  const url = input?.url;
  const requesterUserId = isJsonString(input?.requesterUserId)
    ? input.requesterUserId
    : undefined;
  if (!isJsonString(url))
    return json({ error: "invalid_url" }, { status: 400 });
  const agentOwnerId =
    agent.ownerUserId ??
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
  const result = await sendMachine(
    socket,
    requestId,
    {
      type: "web.fetch",
      requestId,
      url,
      agentId,
      ...(requesterUserId ? { requesterUserId } : undefined),
    },
    answerWithinMs,
  );
  if (!result) return json({ error: "machine_timeout" }, { status: 504 });
  return json(webMachineFetchResultSchema.parse(result));
}

/** Correlate a reply with the exact socket that received the request. Another
 * enrolled machine cannot complete it by guessing or observing an ID. */
async function sendMachine(
  socket: MachineSocket,
  requestId: string,
  command: {
    type: string;
    requestId: string;
    agentId: string;
    url?: string;
    requesterUserId?: string;
    sessionId?: string;
    operation?: string;
    target?: { ref?: string; labels?: string[] };
    text?: string;
    values?: string[];
  },
  timeout: number,
) {
  if (pending.size >= 128)
    throw new HttpError(429, "machine_busy", "Machine capacity is occupied.");
  return new Promise<MachineResult | undefined>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve(undefined);
    }, timeout);
    pending.set(requestId, {
      socket,
      resolve: (answer) => {
        clearTimeout(timer);
        pending.delete(requestId);
        resolve(answer);
      },
    });
    try {
      socket.send(JSON.stringify(command));
    } catch {
      clearTimeout(timer);
      pending.delete(requestId);
      resolve(undefined);
    }
  });
}

/** Online paired machines whose owner lets this agent use them. */
export function pairedMachines(
  ctx: { getWebSockets: (tag?: string) => MachineSocket[] },
  agentId: string,
  ownerId: string,
) {
  return ctx.getWebSockets(webMachineTag).filter((candidate) => {
    const attachment = machineAttachment(candidate);
    return (
      candidate.readyState === openSocket &&
      !!attachment.machineId &&
      admits(attachment, agentId, ownerId, undefined)
    );
  });
}

/** Only the trusted native runtime can dispatch browser operations. Session
 * affinity persists across DO wakeups; an offline machine never causes a
 * session to attach to a different machine's tab. */
export async function browseThroughWebMachine(
  ctx: Pick<DurableObjectState, "storage"> & {
    getWebSockets: (tag?: string) => MachineSocket[];
  },
  channels: WorkspaceChannelStore,
  request: Request,
) {
  const { principal, workspaceId } = readTrustedContext(request);
  if (principal.kind !== "agent" || principal.workspaceId !== workspaceId)
    throw new HttpError(
      403,
      "agents_only",
      "Only workspace agents can use a machine.",
    );
  channels.requirePrincipalMember(principal);
  const agent = requireNativeAgent(ctx.storage, principal.agentId);
  const config = channels.agentConfiguration(principal.agentId);
  if (!config.enabled || !config.toolPermissions.includes("browser.use"))
    throw new HttpError(
      403,
      "browser_denied",
      "Browser access is disabled for this agent.",
    );
  const input = machineBrowserCommandSchema.parse(await request.json());
  const key = `machine.browser:${principal.agentId}:${input.sessionId}`;
  const pinned = await ctx.storage.get<string>(key);
  if (!pinned && input.operation === "close") return json({ closed: true });
  if (!pinned && input.operation !== "open")
    throw new HttpError(
      409,
      "browser_not_open",
      "Open an owned browser session first.",
    );
  const owner =
    agent.ownerUserId ??
    String(channels.requireWorkspace(workspaceId).created_by_user_id);
  const socket = pairedMachines(ctx, principal.agentId, owner)
    .filter(
      (candidate) =>
        !pinned || machineAttachment(candidate).machineId === pinned,
    )
    .reverse()
    .find((candidate) => withinLimits(candidate, Date.now()));
  if (!socket)
    throw new HttpError(
      503,
      "browser_unavailable",
      "No authorized browser machine is online for this session.",
    );
  const machineId = machineAttachment(socket).machineId;
  if (!pinned) await ctx.storage.put(key, machineId);
  const requestId = crypto.randomUUID();
  const answer = await sendMachine(
    socket,
    requestId,
    {
      ...input,
      type: "browser.request",
      requestId,
      agentId: principal.agentId,
    },
    60_000,
  );
  if (!answer)
    throw new HttpError(
      504,
      "browser_timeout",
      "Browser machine did not answer in time.",
    );
  const result = machineBrowserResultSchema.parse(answer);
  if (!result.ok) throw new HttpError(502, "browser_failed", result.error);
  if (input.operation === "close") await ctx.storage.delete(key);
  return json(result.output);
}
