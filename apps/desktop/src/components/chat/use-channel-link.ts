import { useCallback, useState } from "react";

import { RELAY_URL } from "../../lib/config";

type CopyState = "idle" | "copied" | "failed";

/** Copies the channel link, which opens the channel in Chief for members. */
export function useChannelLink(channelId: string) {
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(
        new URL(
          `/open/channel/${encodeURIComponent(channelId)}`,
          RELAY_URL,
        ).toString(),
      );
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1600);
  }, [channelId]);

  return { copyState, copyLink };
}
