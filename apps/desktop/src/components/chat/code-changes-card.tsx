import { useMemo, useState } from "react";
import { ChevronDown, FileCode2 } from "lucide-react";

import { cn } from "@chief/ui/lib/utils";

import type { SessionChange } from "./session-work";
import { insetBandClass, insetCardClass } from "../inset-card";
import { groupFileChanges } from "./message-changes";
import { ChangeDiff } from "./tool-activity-group";

function Lines({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="shrink-0 text-[12px] tabular-nums">
      <span className="text-emerald-600 dark:text-emerald-400">+{added}</span>{" "}
      <span className="text-red-600 dark:text-red-400">−{removed}</span>
    </span>
  );
}

/**
 * The files an agent changed on the way to a reply, nested under it: each
 * opens to its diff, so the work can be reviewed without leaving the thread.
 */
export function CodeChangesCard({
  edits,
}: {
  edits: readonly SessionChange[];
}) {
  const files = useMemo(() => groupFileChanges(edits), [edits]);
  const [open, setOpen] = useState<string | null>(null);
  if (files.length === 0) return null;
  const total = files.reduce(
    (sum, file) => ({
      added: sum.added + file.added,
      removed: sum.removed + file.removed,
    }),
    { added: 0, removed: 0 },
  );
  return (
    <section
      aria-label="Code changes"
      className={cn(insetBandClass, "mt-2 block w-full max-w-2xl text-left")}
    >
      <span className="text-muted-foreground flex h-7 items-center gap-2 px-2.5 text-[12px]">
        <span className="min-w-0 flex-1 truncate">
          {files.length} {files.length === 1 ? "file" : "files"} changed
        </span>
        <Lines {...total} />
      </span>
      <div className={cn(insetCardClass, "space-y-0.5 px-1.5 py-1.5")}>
        {files.map((file) => {
          const name = file.file.split("/").pop() ?? file.file;
          const folder = file.file.slice(0, file.file.length - name.length);
          const expanded = open === file.file;
          return (
            <div key={file.file}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : file.file)}
                className={cn(
                  "hover:bg-foreground/[0.04] flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left transition-colors",
                  expanded && "bg-foreground/[0.05]",
                )}
              >
                <FileCode2
                  size={13}
                  className="text-muted-foreground shrink-0"
                />
                <span className="min-w-0 flex-1 truncate text-[12px]">
                  <span className="text-muted-foreground">{folder}</span>
                  <span className="font-medium">{name}</span>
                </span>
                <Lines added={file.added} removed={file.removed} />
                <ChevronDown
                  size={12}
                  className={cn(
                    "text-muted-foreground shrink-0 transition-transform",
                    !expanded && "-rotate-90",
                  )}
                />
              </button>
              {expanded ? (
                <div className="mt-1 mb-2 space-y-2">
                  {file.changes.map((change) => (
                    <ChangeDiff key={change.id} change={change} />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
