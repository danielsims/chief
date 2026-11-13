import { useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@chief/ui/components/input";

/** What the detail page needs to manage an agent that runs on its own host. */
export interface OwnedAgentControls {
  online: boolean;
  lastSeenAt: string | null;
  /** Null restores the provider's own name. */
  onRename: (displayName: string | null) => Promise<void>;
}

/** The agent's name, which its owner can click to change. */
export function AgentNameEditor({
  name,
  onRename,
}: {
  name: string;
  onRename: (displayName: string | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const commit = async () => {
    if (draft === null) return;
    const next = draft.trim();
    if (next === name) {
      setDraft(null);
      return;
    }
    setSaving(true);
    try {
      await onRename(next || null);
      setDraft(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The name could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };
  if (draft !== null) {
    return (
      <Input
        autoFocus
        value={draft}
        maxLength={48}
        disabled={saving}
        aria-label="Agent name"
        className="h-9 max-w-xs text-[20px] tracking-[-0.03em]"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") void commit();
          if (event.key === "Escape") setDraft(null);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setDraft(name)}
      className="group flex min-w-0 cursor-text items-center gap-2 text-left"
      aria-label={`Rename ${name}`}
    >
      <h2 className="truncate text-[26px] leading-none font-normal tracking-[-0.04em]">
        {name}
      </h2>
      <Pencil
        size={13}
        className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
  );
}

/** Where an owned agent runs: on its owner's host, outside Chief. */
export function OwnedAgentRuntimeCard({
  name,
  online,
  lastSeenAt,
}: {
  name: string;
  online: boolean;
  lastSeenAt: string | null;
}) {
  return (
    <section className="bg-muted/25 rounded-2xl p-4">
      <h3 className="text-sm font-medium">Runtime and model</h3>
      <p className="text-muted-foreground mt-1 text-[13px] leading-5">
        {name} runs on its own host and chooses its own model. Chief only
        controls where it can read and post.
      </p>
      <p className="text-muted-foreground mt-3 flex items-center gap-1.5 text-[12px]">
        <span
          aria-hidden="true"
          className={
            online
              ? "size-1.5 rounded-full bg-emerald-500"
              : "bg-muted-foreground/40 size-1.5 rounded-full"
          }
        />
        {online
          ? "Online"
          : lastSeenAt
            ? `Last seen ${new Date(lastSeenAt).toLocaleString()}`
            : "Not seen yet"}
      </p>
    </section>
  );
}
