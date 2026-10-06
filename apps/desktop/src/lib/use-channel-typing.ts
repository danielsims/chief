import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useWorkspaceUsers } from "../components/chat/mention-people-context";
import { useRuntime, useWorkspaceCapability } from "./runtime";

const emptyTyping: ReadonlyMap<string, number> = new Map();

/** How often a typing person re-announces themselves. */
const TYPING_SEND_INTERVAL_MS = 3_000;
/** How long a typing signal lasts without a refresh. */
const TYPING_EXPIRY_MS = 6_000;

/**
 * Typing indicators for the other people in a channel. `notifyTyping` reports
 * the current draft: a non-empty draft announces typing (throttled), an empty
 * one or a send stops it.
 */
export function useChannelTyping(channelId: string | undefined) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId } = useWorkspaceCapability();
  const users = useWorkspaceUsers();
  // Keyed by channel so switching conversations starts empty.
  const [state, setState] = useState<{
    channelId: string | undefined;
    typing: ReadonlyMap<string, number>;
  }>({ channelId, typing: new Map() });
  const typing = state.channelId === channelId ? state.typing : emptyTyping;
  const setTyping = useCallback(
    (
      update: (
        current: ReadonlyMap<string, number>,
      ) => ReadonlyMap<string, number>,
    ) =>
      setState((current) => {
        const base =
          current.channelId === channelId ? current.typing : emptyTyping;
        const next = update(base);
        return next === base && current.channelId === channelId
          ? current
          : { channelId, typing: next };
      }),
    [channelId],
  );
  const lastSentAt = useRef(0);

  useEffect(() => {
    lastSentAt.current = 0;
    if (!channelId || !cloudOrganizationId || status !== "connected") return;
    return client.subscribe((message) => {
      if (
        message.type !== "userTyping" ||
        message.workspaceId !== cloudOrganizationId ||
        message.channelId !== channelId
      )
        return;
      setTyping((current) => {
        const next = new Map(current);
        if (message.active) next.set(message.userId, Date.now());
        else next.delete(message.userId);
        return next;
      });
    });
  }, [channelId, client, cloudOrganizationId, setTyping, status]);

  useEffect(() => {
    if (typing.size === 0) return;
    const timer = window.setInterval(() => {
      setTyping((current) => {
        const now = Date.now();
        const next = new Map(
          [...current].filter(([, at]) => now - at < TYPING_EXPIRY_MS),
        );
        return next.size === current.size ? current : next;
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [setTyping, typing.size]);

  const notifyTyping = useCallback(
    (draft: string) => {
      if (!channelId || !cloudOrganizationId || status !== "connected") return;
      const active = draft.trim().length > 0;
      const now = Date.now();
      if (active && now - lastSentAt.current < TYPING_SEND_INTERVAL_MS) return;
      if (!active && lastSentAt.current === 0) return;
      lastSentAt.current = active ? now : 0;
      client.send({
        type: "typing",
        workspaceId: cloudOrganizationId,
        channelId,
        active,
      });
    },
    [channelId, client, cloudOrganizationId, status],
  );

  const names = useMemo(
    () =>
      [...typing.keys()].map((userId) => users.get(userId)?.name ?? "Someone"),
    [typing, users],
  );

  return { names, notifyTyping };
}

export function typingLabel(names: readonly string[]) {
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return "Several people are typing…";
}
