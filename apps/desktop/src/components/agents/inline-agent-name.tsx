import { useState } from "react";

/**
 * An agent name that renders as text and becomes an input on click, so it can
 * be renamed during setup or approval.
 */
export function InlineAgentName({
  value,
  fallback,
  onChange,
  maxLength = 40,
  title = "Rename",
}: {
  value: string;
  /** Shown, and restored on blur, when the name is cleared. */
  fallback: string;
  onChange: (name: string) => void;
  maxLength?: number;
  title?: string;
}) {
  const [editing, setEditing] = useState(false);
  const finish = () => {
    setEditing(false);
    if (!value.trim()) onChange(fallback);
  };
  return editing ? (
    <input
      autoFocus
      aria-label="Agent name"
      value={value}
      maxLength={maxLength}
      size={Math.max(value.length, 3)}
      onChange={(event) => onChange(event.target.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "Escape") finish();
      }}
      className="bg-foreground/[0.06] rounded-[5px] font-medium outline-none"
    />
  ) : (
    <button
      type="button"
      title={title}
      onClick={() => setEditing(true)}
      className="hover:bg-foreground/[0.06] -mx-0.5 cursor-text rounded-[5px] px-0.5 font-medium"
    >
      {value.trim() || fallback}
    </button>
  );
}
