import { CircleAlert } from "lucide-react";
import { createPortal } from "react-dom";

export function ChatErrorStatus({ onOpen }: { onOpen: () => void }) {
  const target = document.getElementById("chief-app-status");
  if (!target) return null;
  return createPortal(
    <button
      type="button"
      className="border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/15 flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors"
      onClick={onOpen}
      title="Open the activity panel to inspect this error"
    >
      <CircleAlert size={12} />1 Error
    </button>,
    target,
  );
}
