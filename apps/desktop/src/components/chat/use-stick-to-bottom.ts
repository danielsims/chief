import type { RefObject } from "react";
import { useLayoutEffect } from "react";

const BOTTOM_THRESHOLD_PX = 80;

/**
 * Keeps a scrolling timeline at its newest content while the reader is at the
 * bottom. Whether they are is decided by their own scrolling, before content
 * grows, so a long new message or streamed text never unpins them, and
 * scrolling up to read is never interrupted.
 */
export function useStickToBottom(
  containerRef: RefObject<HTMLElement | null>,
  key: string | null,
  startAtBottom: () => boolean,
) {
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!key || !container) return;
    let pinned = startAtBottom();
    const follow = () => {
      if (pinned) container.scrollTop = container.scrollHeight;
    };
    const onScroll = () => {
      pinned =
        container.scrollHeight - container.scrollTop - container.clientHeight <
        BOTTOM_THRESHOLD_PX;
    };
    follow();
    container.addEventListener("scroll", onScroll, { passive: true });
    const mutations = new MutationObserver(follow);
    mutations.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const resizes = new ResizeObserver(follow);
    resizes.observe(container);
    return () => {
      container.removeEventListener("scroll", onScroll);
      mutations.disconnect();
      resizes.disconnect();
    };
    // startAtBottom is read once per opened timeline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, key]);
}
