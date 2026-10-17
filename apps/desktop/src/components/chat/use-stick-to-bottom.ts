import { useEffect, useEffectEvent, useLayoutEffect } from "react";
import { useStickToBottom } from "use-stick-to-bottom";

const TOP_THRESHOLD_PX = 200;

/**
 * Keeps a conversation at its newest content while the reader is at the
 * bottom. use-stick-to-bottom stops following when they scroll up or select
 * text, so reading and copying are never interrupted. Each newly opened
 * conversation starts at the bottom, unless it opened to show one message.
 * Near the top, `onReachTop` loads earlier history, and the reader keeps
 * their place as it appears above them.
 */
export function useConversationScroll(
  key: string | null,
  startAtBottom: () => boolean,
  onReachTop?: () => void,
) {
  const scroll = useStickToBottom({ initial: "instant", resize: "instant" });
  useLayoutEffect(() => {
    if (!key) return;
    if (startAtBottom()) void scroll.scrollToBottom("instant");
    else scroll.stopScroll();
    // startAtBottom is read once per opened conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const reachTop = useEffectEvent(() => onReachTop?.());
  const loadsEarlier = onReachTop !== undefined;
  useEffect(() => {
    const element = scroll.scrollRef.current;
    const content = scroll.contentRef.current;
    if (!key || !loadsEarlier || !element || !content) return;
    // Distance from the bottom when earlier history was asked for.
    let fromBottom: number | undefined;
    const onScroll = () => {
      if (fromBottom !== undefined || element.scrollTop > TOP_THRESHOLD_PX)
        return;
      fromBottom = element.scrollHeight - element.scrollTop;
      reachTop();
    };
    const resized = new ResizeObserver(() => {
      if (fromBottom === undefined) return;
      element.scrollTop = element.scrollHeight - fromBottom;
      fromBottom = undefined;
    });
    element.addEventListener("scroll", onScroll, { passive: true });
    resized.observe(content);
    return () => {
      element.removeEventListener("scroll", onScroll);
      resized.disconnect();
    };
  }, [key, loadsEarlier, scroll.contentRef, scroll.scrollRef]);
  return scroll;
}
