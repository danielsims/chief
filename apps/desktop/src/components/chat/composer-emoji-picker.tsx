import { useEffect, useRef } from "react";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import { init } from "emoji-mart";

let warmStarted = false;

function warmEmojiIndex() {
  if (warmStarted) return;
  warmStarted = true;
  const warm = () => void init({ data });
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(warm, { timeout: 1_500 });
  } else {
    globalThis.setTimeout(warm, 250);
  }
}

warmEmojiIndex();

function configureSearch(host: HTMLDivElement) {
  const picker = host.querySelector("em-emoji-picker");
  const root = picker?.shadowRoot;
  if (!root) return;
  const apply = () => {
    const input = root.querySelector<HTMLInputElement>('input[type="search"]');
    if (!input) return false;
    input.spellcheck = false;
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    input.focus();
    return true;
  };
  if (apply()) return;
  const observer = new MutationObserver(() => {
    if (apply()) observer.disconnect();
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}

export function ComposerEmojiPicker({
  onSelect,
}: {
  onSelect: (emoji: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hostRef.current) return configureSearch(hostRef.current);
  }, []);

  return (
    <div ref={hostRef}>
      <Picker
        autoFocus
        data={data}
        maxFrequentRows={2}
        onEmojiSelect={(emoji: { native?: string }) => {
          if (emoji.native) onSelect(emoji.native);
        }}
        perLine={8}
        previewPosition="none"
        set="native"
        skinTonePosition="search"
        theme="auto"
      />
    </div>
  );
}
