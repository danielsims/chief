import { useLayoutEffect } from "react";
import { useStickToBottom } from "use-stick-to-bottom";

/**
 * Keeps a conversation at its newest content while the reader is at the
 * bottom. use-stick-to-bottom stops following when they scroll up or select
 * text, so reading and copying are never interrupted. Each newly opened
 * conversation starts at the bottom, unless it opened to show one message.
 */
export function useConversationScroll(
  key: string | null,
  startAtBottom: () => boolean,
) {
  const scroll = useStickToBottom({ initial: "instant", resize: "instant" });
  useLayoutEffect(() => {
    if (!key) return;
    if (startAtBottom()) void scroll.scrollToBottom("instant");
    else scroll.stopScroll();
    // startAtBottom is read once per opened conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return scroll;
}
