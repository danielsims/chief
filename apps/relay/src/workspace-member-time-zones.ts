import { z } from "zod";

import { isTimeZone } from "@chief/agent-runtime/web-reading";

import { HttpError, json } from "./http";
import { readTrustedContext } from "./internal-context";

/**
 * Each member's time zone, as their app last reported it, so an agent can
 * tell the time where the person it's working for is.
 */
const key = (userId: string) => `member.time-zone:${userId}`;

const timeZoneSchema = z.string().min(1).max(64).refine(isTimeZone);

/** A member's app reports its zone when it opens. */
export async function setMemberTimeZone(
  storage: DurableObjectStorage,
  request: Request,
) {
  const { principal } = readTrustedContext(request);
  if (principal.kind !== "user")
    throw new HttpError(403, "members_only", "Only members have a time zone.");
  const { timeZone } = z
    .object({ timeZone: timeZoneSchema })
    .parse(await request.json());
  if ((await storage.get(key(principal.userId))) !== timeZone)
    await storage.put(key(principal.userId), timeZone);
  return json({ ok: true });
}

/** An agent reads the zone of the member it's working for. */
export async function readMemberTimeZone(
  storage: DurableObjectStorage,
  request: Request,
) {
  const { principal } = readTrustedContext(request);
  if (principal.kind !== "agent")
    throw new HttpError(403, "agents_only", "Only agents read time zones.");
  const { userId } = z
    .object({ userId: z.string().min(1).max(200) })
    .parse(await request.json());
  const stored = timeZoneSchema.safeParse(await storage.get(key(userId)));
  return json(stored.success ? { timeZone: stored.data } : {});
}
