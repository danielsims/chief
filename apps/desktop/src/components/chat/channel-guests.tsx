import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";

import type { ChannelGuestSummary } from "@chief/relay-contracts";

import { RELAY_URL } from "../../lib/config";
import { guestLabel, guestSummaryAppearance } from "../../lib/guest-appearance";
import { useRelaySession } from "../../lib/relay-session";
import { GuestAvatar } from "../guest-avatar";

type CopyState = "idle" | "copied" | "failed";

/**
 * The two links a channel hands out. The channel link opens it in Chief for
 * members and admits no one. The invite admits the member's own agent, once,
 * within 24 hours.
 */
export function useChannelLinks(channelId: string) {
  const { client } = useRelaySession();
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [inviteState, setInviteState] = useState<CopyState>("idle");

  const settle = useCallback(
    (set: (state: CopyState) => void, next: CopyState) => {
      set(next);
      window.setTimeout(() => set("idle"), 1600);
    },
    [],
  );

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(
        new URL(
          `/open/channel/${encodeURIComponent(channelId)}`,
          RELAY_URL,
        ).toString(),
      );
      settle(setCopyState, "copied");
    } catch {
      settle(setCopyState, "failed");
    }
  }, [channelId, settle]);

  const copyInvite = useCallback(async () => {
    if (!client) return;
    try {
      const invite = await client.channelGuests.invite(channelId);
      await navigator.clipboard.writeText(invite.url);
      settle(setInviteState, "copied");
    } catch {
      settle(setInviteState, "failed");
    }
  }, [channelId, client, settle]);

  return { copyState, copyLink, inviteState, copyInvite };
}

/** The guest agents in a channel, while `enabled`. Changing `revision`
 * (e.g. the number of "joined the channel" lines) reloads them. */
export function useChannelGuests(
  channelId: string,
  enabled: boolean,
  revision = 0,
) {
  const { client } = useRelaySession();
  const [loaded, setLoaded] = useState<{
    channelId: string;
    guests: ChannelGuestSummary[];
  } | null>(null);

  useEffect(() => {
    if (!enabled || !client) return;
    let cancelled = false;
    void client.channelGuests
      .list(channelId)
      .then((guests) => {
        if (!cancelled) setLoaded({ channelId, guests });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ channelId, guests: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, client, enabled, revision]);

  const guests =
    enabled && loaded?.channelId === channelId ? loaded.guests : [];
  const setGuests = useCallback(
    (next: (current: ChannelGuestSummary[]) => ChannelGuestSummary[]) =>
      setLoaded((current) => ({
        channelId,
        guests: next(current?.channelId === channelId ? current.guests : []),
      })),
    [channelId],
  );
  return { guests, setGuests };
}

/** Agents members invited into the channel. */
export function ChannelGuestRows({
  channelId,
  open,
}: {
  channelId: string;
  open: boolean;
}) {
  const { client } = useRelaySession();
  const { guests, setGuests } = useChannelGuests(channelId, open);

  const remove = async (guestId: string) => {
    if (!client) return;
    setGuests((current) => current.filter((guest) => guest.id !== guestId));
    await client.channelGuests.remove(channelId, guestId).catch(() => {
      void client.channelGuests.list(channelId).then((next) => {
        setGuests(() => next);
      });
    });
  };

  return guests.map((guest) => (
    <div
      key={guest.id}
      className="group/guest hover:bg-accent flex w-full items-center gap-2.5 rounded-lg px-2 py-2 transition-colors"
    >
      <GuestAvatar
        className="size-7 rounded-lg text-[9px]"
        guest={guestSummaryAppearance(guest)}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{guest.name}</span>
        <span className="text-muted-foreground block truncate text-[10px]">
          {guestLabel(guestSummaryAppearance(guest))}
        </span>
      </span>
      <button
        type="button"
        aria-label={`Remove ${guest.name}`}
        title={`Remove ${guest.name}`}
        onClick={() => void remove(guest.id)}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/30 rounded-md p-1 opacity-0 transition-opacity outline-none group-hover/guest:opacity-100 focus-visible:opacity-100 focus-visible:ring-2"
      >
        <X size={12} />
      </button>
    </div>
  ));
}
