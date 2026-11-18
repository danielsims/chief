import { z } from "zod";

import type { WorkspaceChannelStore } from "./workspace-channel-store";
import { randomToken, sha256 } from "./external-agent-channel-security";
import { HttpError, json } from "./http";
import { readTrustedContext } from "./internal-context";
import {
  createMachineTunnel,
  deleteMachineTunnel,
  machineStreamConfig,
  machineTunnelSchema,
  machineTunnelToken,
} from "./machine-stream-tunnels";
import { requireNativeAgent } from "./workspace-agent-runtime";

/**
 * Machines without the app pair by running a
 * one-time command their owner copies from the app. The command's code is
 * swapped once for the machine's own key, which can do only one thing: open
 * the socket that lends the machine's connection to this workspace's agents.
 * It can't read conversations or act as its owner. Only hashes are stored.
 */

const pairingLifetimeMs = 15 * 60_000;
const ticketLifetimeMs = 60_000;

const pairingSchema = z.object({
  ownerUserId: z.string(),
  expiresAt: z.number(),
});
const machineSchema = z.object({
  machineId: z.uuid(),
  ownerUserId: z.string(),
  name: z.string(),
  keyHash: z.string(),
  createdAt: z.number(),
  /** Its tunnel for live browser views, and the secret viewer tickets are
   * signed with; set the first time the machine asks to stream. */
  stream: machineTunnelSchema.extend({ secret: z.string() }).optional(),
});
const ticketSchema = z.object({
  machineId: z.uuid(),
  ownerUserId: z.string(),
  name: z.string(),
  expiresAt: z.number(),
});
export type MachineTicket = z.infer<typeof ticketSchema>;

const pairingKey = (hash: string) => `machine-pairing:${hash}`;
const machineKey = (machineId: string) => `machine:${machineId}`;
const keyIndex = (hash: string) => `machine-key:${hash}`;
const ticketKey = (hash: string) => `machine-ticket:${hash}`;

/** A machine works only while its owner is still in the workspace. */
function requireMember(channels: WorkspaceChannelStore, userId: string) {
  if (!channels.memberRole("user", userId))
    throw new HttpError(
      403,
      "owner_not_member",
      "This machine's owner is no longer in the workspace.",
    );
}

function bearer(request: Request) {
  return /^Bearer (.+)$/u.exec(request.headers.get("authorization") ?? "")?.[1];
}

async function readMachine(storage: DurableObjectStorage, machineId: string) {
  const parsed = machineSchema.safeParse(
    await storage.get(machineKey(machineId)),
  );
  return parsed.success ? parsed.data : undefined;
}

/** The owner asks for a one-time pairing code, shown as a command to run. */
export async function createMachinePairing(
  storage: DurableObjectStorage,
  request: Request,
) {
  const { principal } = readTrustedContext(request);
  if (principal.kind !== "user")
    throw new HttpError(403, "members_only", "Only members can add machines.");
  const code = randomToken();
  await storage.put(pairingKey(await sha256(code)), {
    ownerUserId: principal.userId,
    expiresAt: Date.now() + pairingLifetimeMs,
  } satisfies z.infer<typeof pairingSchema>);
  return json({ code, expiresInSeconds: pairingLifetimeMs / 1000 });
}

/** A machine swaps its pairing code, once, for its own key. */
export async function claimMachinePairing(
  storage: DurableObjectStorage,
  channels: WorkspaceChannelStore,
  request: Request,
) {
  const input = z
    .object({
      code: z.string().min(16).max(200),
      name: z.string().trim().min(1).max(80),
    })
    .parse(await request.json());
  const codeHash = await sha256(input.code);
  const pairing = pairingSchema.safeParse(
    await storage.get(pairingKey(codeHash)),
  );
  // Single use, whether or not it's still valid.
  await storage.delete(pairingKey(codeHash));
  if (!pairing.success || pairing.data.expiresAt < Date.now())
    throw new HttpError(
      401,
      "pairing_invalid",
      "That pairing code is invalid or has expired. Add the machine again.",
    );
  requireMember(channels, pairing.data.ownerUserId);
  const machineId = crypto.randomUUID();
  const key = randomToken();
  const keyHash = await sha256(key);
  await storage.put({
    [machineKey(machineId)]: {
      machineId,
      ownerUserId: pairing.data.ownerUserId,
      name: input.name,
      keyHash,
      createdAt: Date.now(),
    } satisfies z.infer<typeof machineSchema>,
    [keyIndex(keyHash)]: machineId,
  });
  return json({ machineId, key }, { status: 201 });
}

/**
 * A paired machine trades its key for a short-lived ticket to open its
 * lending socket, provided its owner is still a member.
 */
export async function createMachineTicket(
  storage: DurableObjectStorage,
  channels: WorkspaceChannelStore,
  request: Request,
) {
  const machine = await machineForKey(storage, channels, request);
  const ticket = randomToken();
  await storage.put(ticketKey(await sha256(ticket)), {
    machineId: machine.machineId,
    ownerUserId: machine.ownerUserId,
    name: machine.name,
    expiresAt: Date.now() + ticketLifetimeMs,
  } satisfies MachineTicket);
  return json({ ticket }, { status: 201 });
}

/** Spends a machine ticket; undefined when it's unknown or stale. */
export async function consumeMachineTicket(
  storage: DurableObjectStorage,
  ticket: string,
) {
  const hash = await sha256(ticket);
  const stored = ticketSchema.safeParse(await storage.get(ticketKey(hash)));
  if (!stored.success) return undefined;
  await storage.delete(ticketKey(hash));
  return stored.data.expiresAt < Date.now() ? undefined : stored.data;
}

/** The owner's paired machines. */
export async function listMachines(
  storage: DurableObjectStorage,
  request: Request,
  online: ReadonlySet<string>,
) {
  const { principal } = readTrustedContext(request);
  if (principal.kind !== "user") return json({ machines: [] });
  const machines = [...(await storage.list({ prefix: "machine:" })).values()]
    .flatMap((value) => {
      const machine = machineSchema.safeParse(value);
      return machine.success && machine.data.ownerUserId === principal.userId
        ? [machine.data]
        : [];
    })
    .map(({ machineId, name, createdAt }) => ({
      id: machineId,
      name,
      createdAt,
      online: online.has(machineId),
    }));
  return json({ machines });
}

/** The paired machine a machine key belongs to, if its owner is a member. */
async function machineForKey(
  storage: DurableObjectStorage,
  channels: WorkspaceChannelStore,
  request: Request,
) {
  const key = bearer(request);
  const machineId = key
    ? await storage.get<string>(keyIndex(await sha256(key)))
    : undefined;
  const machine = machineId ? await readMachine(storage, machineId) : undefined;
  if (!machine)
    throw new HttpError(401, "machine_unknown", "This machine isn't paired.");
  requireMember(channels, machine.ownerUserId);
  return machine;
}

/**
 * A machine asks to stream its browser: it gets its own tunnel, created the
 * first time, the token `cloudflared` runs it with, and the secret it checks
 * viewer tickets against.
 */
export async function setUpMachineStream(
  env: Env,
  storage: DurableObjectStorage,
  channels: WorkspaceChannelStore,
  request: Request,
) {
  const machine = await machineForKey(storage, channels, request);
  const config = machineStreamConfig(env);
  if (!config)
    throw new HttpError(
      503,
      "stream_unavailable",
      "This relay doesn't stream machine browsers.",
    );
  const stream = machine.stream ?? {
    ...(await createMachineTunnel(config, machine.machineId)),
    secret: randomToken(),
  };
  if (!machine.stream)
    await storage.put(machineKey(machine.machineId), { ...machine, stream });
  return json({
    hostname: stream.hostname,
    tunnelToken: await machineTunnelToken(config, stream),
    streamSecret: stream.secret,
  });
}

const viewerTicketLifetimeMs = 60_000;
const pinnedSessionSchema = z.object({
  machineId: z.string(),
  conversationId: z.string().optional(),
});

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

/** The machine holding one agent's browser session, if it streams. */
async function streamingMachine(
  storage: DurableObjectStorage,
  agentId: string,
  sessionId: string,
) {
  const pinned = pinnedSessionSchema.safeParse(
    await storage.get(`machine.browser:${agentId}:${sessionId}`),
  );
  const machine = pinned.success
    ? await readMachine(storage, pinned.data.machineId)
    : undefined;
  return machine?.stream && pinned.success
    ? {
        ...machine,
        stream: machine.stream,
        conversationId: pinned.data.conversationId,
      }
    : undefined;
}

function streamUrl(hostname: string, sessionId: string) {
  return `wss://${hostname}/stream/${sessionId}`;
}

/**
 * Where an agent's browser session can be watched, for its browser card.
 * The address holds no secret; a viewer still needs a ticket.
 */
export async function machineBrowserStream(
  storage: DurableObjectStorage,
  request: Request,
) {
  const { principal } = readTrustedContext(request);
  if (principal.kind !== "agent")
    throw new HttpError(403, "agents_only", "Only agents stream a browser.");
  const { sessionId } = z
    .object({ sessionId: z.uuid() })
    .parse(await request.json());
  const machine = await streamingMachine(storage, principal.agentId, sessionId);
  if (!machine)
    throw new HttpError(404, "stream_unavailable", "No live view to show.");
  return json({
    streamUrl: streamUrl(machine.stream.hostname, sessionId),
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  });
}

/**
 * A member's one-time ticket to watch an agent's browser session, signed
 * with the machine's stream secret, which the machine checks itself.
 */
export async function createMachineViewerTicket(
  storage: DurableObjectStorage,
  channels: WorkspaceChannelStore,
  request: Request,
) {
  const { principal } = readTrustedContext(request);
  if (
    principal.kind !== "user" ||
    !channels.memberRole("user", principal.userId)
  )
    throw new HttpError(403, "members_only", "Only members can watch.");
  const input = z
    .object({ agentId: z.string().min(1).max(200), sessionId: z.uuid() })
    .parse(await request.json());
  const machine = await streamingMachine(
    storage,
    input.agentId,
    input.sessionId,
  );
  // Watching needs the conversation the browser is shown in, as reading
  // it does; clicking and typing is for the agent's owner alone.
  if (
    !machine?.conversationId ||
    !channels.canReadConversation(machine.conversationId, principal)
  )
    throw new HttpError(404, "stream_unavailable", "No live view to show.");
  const control =
    requireNativeAgent(storage, input.agentId).ownerUserId === principal.userId;
  const payload = base64Url(
    new TextEncoder().encode(
      JSON.stringify({
        v: 1,
        s: input.sessionId,
        c: control,
        exp: Date.now() + viewerTicketLifetimeMs,
        n: randomToken(),
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(machine.stream.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = base64Url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
    ),
  );
  return json({
    url: streamUrl(machine.stream.hostname, input.sessionId),
    protocols: ["chief-stream.v1", `chief-ticket.${payload}.${signature}`],
  });
}

/** The owner removes a machine; its key stops working at once. */
export async function revokeMachine(
  env: Env,
  storage: DurableObjectStorage,
  request: Request,
  onRevoked: (machineId: string) => void,
) {
  const { principal } = readTrustedContext(request);
  const { machineId } = z
    .object({ machineId: z.uuid() })
    .parse(await request.json());
  const machine = await readMachine(storage, machineId);
  if (
    !machine ||
    principal.kind !== "user" ||
    machine.ownerUserId !== principal.userId
  )
    throw new HttpError(404, "machine_not_found", "That machine wasn't found.");
  await storage.delete([machineKey(machineId), keyIndex(machine.keyHash)]);
  onRevoked(machineId);
  const config = machineStreamConfig(env);
  if (config && machine.stream)
    await deleteMachineTunnel(config, machine.stream).catch((error: unknown) =>
      console.error("[machines] tunnel cleanup:", error),
    );
  return json({ ok: true });
}
