import { FolderGit2 } from "lucide-react";

import { cn } from "@chief/ui/lib/utils";

export function ProjectIcon({
  dataUrl,
  className,
}: {
  dataUrl?: string;
  className?: string;
}) {
  return dataUrl ? (
    <img
      src={dataUrl}
      alt=""
      className={cn("size-10 shrink-0 rounded-xl object-cover", className)}
    />
  ) : (
    <span
      className={cn(
        "bg-background/70 flex size-10 shrink-0 items-center justify-center rounded-xl shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]",
        className,
      )}
    >
      <FolderGit2 size={18} strokeWidth={1.6} />
    </span>
  );
}
