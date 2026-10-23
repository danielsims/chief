import { useEffect, useState } from "react";

import type { RelayClient } from "@chief/relay-client";
import { attachmentLocation } from "@chief/relay-contracts";

import { useRelaySession } from "../../lib/relay-session-context";

// Attachments are private to their channel, so each is read through the relay
// as the signed-in person and kept per session, never shared across accounts.
const sessions = new WeakMap<RelayClient, Map<string, Promise<string>>>();

function objectUrl(client: RelayClient, url: string) {
  const loaded = sessions.get(client) ?? new Map<string, Promise<string>>();
  sessions.set(client, loaded);
  const cached = loaded.get(url);
  if (cached) return cached;
  const pending = client
    .downloadAttachment(url)
    .then(({ bytes, mediaType }) =>
      URL.createObjectURL(new Blob([bytes], { type: mediaType })),
    );
  // A failed read can be tried again next time the image is shown.
  pending.catch(() => loaded.delete(url));
  loaded.set(url, pending);
  return pending;
}

/**
 * Where to show an attached image from: a local preview as it is, a relay
 * attachment once it has been read with the person's own credentials.
 */
export function useAttachmentSource(url: string) {
  const { client } = useRelaySession();
  const relayAttachment = Boolean(attachmentLocation(url));
  const [loaded, setLoaded] = useState<{ url: string; source: string }>();
  const [failedUrl, setFailedUrl] = useState<string>();
  useEffect(() => {
    if (!relayAttachment || !client) return;
    let current = true;
    objectUrl(client, url).then(
      (value) => {
        if (current) setLoaded({ url, source: value });
      },
      () => {
        if (current) setFailedUrl(url);
      },
    );
    return () => {
      current = false;
    };
  }, [client, relayAttachment, url]);
  return {
    source: relayAttachment
      ? loaded?.url === url
        ? loaded.source
        : undefined
      : url,
    failed: failedUrl === url,
  };
}

/** An attached image in a message, opening full size in a new window. */
export function AttachmentImage({
  name,
  url,
  className,
}: {
  name: string;
  url: string;
  className?: string;
}) {
  const { source, failed } = useAttachmentSource(url);
  if (failed)
    return (
      <span className="text-muted-foreground flex size-full min-h-28 items-center justify-center px-3 text-center text-xs">
        Couldn't load {name}
      </span>
    );
  return source ? (
    <a
      href={source}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${name}`}
      className="block size-full"
    >
      <img src={source} alt={name} className={className} />
    </a>
  ) : (
    <span
      aria-label={`Loading ${name}`}
      className="bg-muted/80 block size-full min-h-28 animate-pulse"
    />
  );
}
