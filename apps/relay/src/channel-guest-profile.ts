import type {
  GrokBotColor,
  GrokBotSilhouette,
  GuestMark,
  GuestOperator,
  GuestProfile,
  GuestProvider,
} from "@chief/relay-contracts";
import {
  grokBotColors,
  grokBotSilhouettes,
  guestMarkSchema,
  guestProfileSchema,
  guestProviderSchema,
  userIdSchema,
} from "@chief/relay-contracts";

import type { ChannelGuestRow } from "./queries/channel-guests/guests";
import { memberDisplayNames } from "./workspace-member-names";

/**
 * A Grok Bot's avatar from its own `profile.json` values. Anything outside
 * the known lists falls back to a plain grey blob rather than refusing the
 * join, and no other text from the file is kept.
 */
export function grokBotMark(input: {
  avatarShape?: string | undefined;
  avatarColor?: string | undefined;
}): GuestMark {
  return {
    style: "grok-bot",
    shape:
      known(grokBotSilhouettes, input.avatarShape?.toLowerCase()) ?? "blob",
    color: known(grokBotColors, input.avatarColor?.toLowerCase()) ?? "gray",
  };
}

function known<T extends GrokBotSilhouette | GrokBotColor>(
  values: readonly T[],
  value: string | undefined,
) {
  return values.find((candidate) => candidate === value);
}

export function storedGuestMark(guest: ChannelGuestRow) {
  if (!guest.mark_shape || !guest.mark_color) return undefined;
  const parsed = guestMarkSchema.safeParse({
    style: "grok-bot",
    shape: guest.mark_shape,
    color: guest.mark_color,
  });
  return parsed.success ? parsed.data : undefined;
}

/** The member an agent works for: whoever sent its invite. */
export function guestOperator(
  storage: DurableObjectStorage,
  guest: ChannelGuestRow,
): GuestOperator | undefined {
  if (!guest.operator_user_id) return undefined;
  return {
    id: userIdSchema.parse(guest.operator_user_id),
    name: operatorDisplayName(storage, guest) ?? "A workspace member",
  };
}

function operatorDisplayName(
  storage: DurableObjectStorage,
  guest: ChannelGuestRow,
) {
  return guest.operator_user_id
    ? memberDisplayNames(storage).get(`user:${guest.operator_user_id}`)
    : undefined;
}

/** The stored provider, or "other" for anything unknown. */
export function storedGuestProvider(guest: ChannelGuestRow): GuestProvider {
  const parsed = guestProviderSchema.safeParse(guest.provider);
  return parsed.success ? parsed.data : "other";
}

export function guestProfile(
  storage: DurableObjectStorage,
  guest: ChannelGuestRow,
): GuestProfile {
  return guestProfileSchema.parse({
    name: guest.name,
    provider: storedGuestProvider(guest),
    model: guest.model ?? undefined,
    image: guest.avatar_url ?? undefined,
    mark: storedGuestMark(guest),
    operator: guestOperator(storage, guest),
  });
}

/** The handle an agent would want: its name, namespaced by the member it
 * works for (`danielsims:claude`) when that member has a display name. */
export function preferredGuestHandle(
  storage: DurableObjectStorage,
  guest: ChannelGuestRow,
) {
  const agent = handlePart(guest.name) || "agent";
  const member = handlePart(operatorDisplayName(storage, guest) ?? "");
  return member ? `${member}:${agent}` : agent;
}

/** The agent's handle, as assigned when it joined. */
export function guestHandle(
  storage: DurableObjectStorage,
  guest: ChannelGuestRow,
) {
  return guest.handle ?? preferredGuestHandle(storage, guest);
}

/** Agents may share a name, so a taken handle gets the next free suffix:
 * `claude`, `claude-2`, `claude-3`. */
export function uniqueGuestHandle(
  storage: DurableObjectStorage,
  others: readonly ChannelGuestRow[],
  preferred: string,
) {
  const taken = new Set(others.map((guest) => guestHandle(storage, guest)));
  if (!taken.has(preferred)) return preferred;
  let suffix = 2;
  while (taken.has(`${preferred}-${suffix}`)) suffix += 1;
  return `${preferred}-${suffix}`;
}

function handlePart(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}
