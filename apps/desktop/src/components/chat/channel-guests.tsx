import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { z } from "zod";

import type {
  ChannelExternalAccess,
  ChannelGuestSummary,
} from "@chief/relay-contracts";
import { channelExternalAccessSchema } from "@chief/relay-contracts";

import { useRelaySession } from "../../lib/relay-session";
import { AvatarImage } from "../avatar-image";

type CopyState = "idle" | "copied" | "failed";

const EXTERNAL_CHANGED_EVENT = "chief:channel-external-changed";

const externalChangeSchema = z.object({
  channelId: z.string().min(1),
  access: channelExternalAccessSchema,
});

/**
 * Whether outsiders can join the channel, shared by everything that shows it.
 * Only workspace owners and admins can change it; the relay enforces that.
 */
export function useChannelExternalAccess(channelId: string, enabled: boolean) {
  const { client } = useRelaySession();
  // Keyed by channel so switching channels never shows the previous state.
  const [loaded, setLoaded] = useState<{
    channelId: string;
    access: ChannelExternalAccess;
  } | null>(null);
  const access =
    enabled && loaded?.channelId === channelId ? loaded.access : null;
  const [copyState, setCopyState] = useState<CopyState>("idle");

  useEffect(() => {
    if (!enabled || !client) return;
    let cancelled = false;
    void client.channelGuests
      .external(channelId)
      .then((next) => {
        if (!cancelled) setLoaded({ channelId, access: next });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ channelId, access: { external: false } });
      });
    const onChange = (event: Event) => {
      const change =
        event instanceof CustomEvent
          ? externalChangeSchema.safeParse(event.detail)
          : null;
      if (change?.success && change.data.channelId === channelId) {
        setLoaded(change.data);
      }
    };
    window.addEventListener(EXTERNAL_CHANGED_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(EXTERNAL_CHANGED_EVENT, onChange);
    };
  }, [channelId, client, enabled]);

  const settle = useCallback((next: CopyState) => {
    setCopyState(next);
    window.setTimeout(() => setCopyState("idle"), 1600);
  }, []);

  const publish = useCallback(
    (next: ChannelExternalAccess) => {
      window.dispatchEvent(
        new CustomEvent(EXTERNAL_CHANGED_EVENT, {
          detail: { channelId, access: next },
        }),
      );
    },
    [channelId],
  );

  const setExternal = useCallback(
    async (external: boolean) => {
      if (!client) return;
      publish(await client.channelGuests.setExternal(channelId, external));
    },
    [channelId, client, publish],
  );

  /** External channels copy their join link; every other conversation keeps
   * its in-app link. */
  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(
        access?.external ? access.url : window.location.href,
      );
      settle("copied");
    } catch {
      settle("failed");
    }
  }, [access, settle]);

  const resetLink = useCallback(async () => {
    if (!client) return;
    try {
      const next = await client.channelGuests.resetLink(channelId);
      publish(next);
      if (next.external) await navigator.clipboard.writeText(next.url);
      settle("copied");
    } catch {
      settle("failed");
    }
  }, [channelId, client, publish, settle]);

  return {
    external: access?.external === true,
    loaded: access !== null,
    copyState,
    copyLink,
    resetLink,
    setExternal,
  };
}

/** Guest agents admitted to the channel through its link. */
export function ChannelGuestRows({
  channelId,
  open,
}: {
  channelId: string;
  open: boolean;
}) {
  const { client } = useRelaySession();
  const [guests, setGuests] = useState<ChannelGuestSummary[]>([]);

  useEffect(() => {
    if (!open || !client) return;
    let cancelled = false;
    void client.channelGuests
      .list(channelId)
      .then((next) => {
        if (!cancelled) setGuests(next);
      })
      .catch(() => {
        if (!cancelled) setGuests([]);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, client, open]);

  const remove = async (guestId: string) => {
    if (!client) return;
    setGuests((current) => current.filter((guest) => guest.id !== guestId));
    await client.channelGuests.remove(channelId, guestId).catch(() => {
      void client.channelGuests.list(channelId).then(setGuests);
    });
  };

  return guests.map((guest) => (
    <div
      key={guest.id}
      className="group/guest hover:bg-accent flex w-full items-center gap-2.5 rounded-lg px-2 py-2 transition-colors"
    >
      <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-lg text-[9px] font-semibold">
        <AvatarImage
          className="size-full object-cover"
          fallback={guest.name.charAt(0).toLocaleUpperCase()}
          src={guest.image}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{guest.name}</span>
        <span className="text-muted-foreground block truncate text-[10px]">
          Guest agent
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
