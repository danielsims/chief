import { z } from "zod";

import type { WorkspaceChannelStore } from "./workspace-channel-store";
import { randomToken, sha256 } from "./external-agent-channel-security";
import { HttpError, json } from "./http";
import { readTrustedContext } from "./internal-context";

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
  const key = bearer(request);
  const machineId = key
    ? await storage.get<string>(keyIndex(await sha256(key)))
    : undefined;
  const machine = machineId ? await readMachine(storage, machineId) : undefined;
  if (!machine)
    throw new HttpError(401, "machine_unknown", "This machine isn't paired.");
  requireMember(channels, machine.ownerUserId);
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

/** The owner removes a machine; its key stops working at once. */
export async function revokeMachine(
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
  return json({ ok: true });
}
