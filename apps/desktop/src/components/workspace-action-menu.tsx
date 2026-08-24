import { useState } from "react";
import { ArrowRight, Check, Copy, Settings } from "lucide-react";

import { PopoverContent } from "@chief/ui/components/popover";

export function nextWorkspaceMenuId(
  currentId: string | null,
  menuId: string,
  open: boolean,
) {
  if (open) return menuId;
  return currentId === menuId ? null : currentId;
}

export function WorkspaceActionsPopover({
  primaryLabel,
  primaryDisabled = false,
  onPrimaryAction,
  workspaceName,
  relayUrl,
}: {
  primaryLabel: "Open workspace" | "Workspace settings";
  primaryDisabled?: boolean;
  onPrimaryAction: () => void;
  workspaceName: string;
  relayUrl: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <PopoverContent
      side="right"
      align="start"
      sideOffset={8}
      className="w-64 p-1.5"
      onOpenAutoFocus={(event) => event.preventDefault()}
    >
      <div className="px-2 py-2">
        <p className="truncate text-[13px] font-semibold">{workspaceName}</p>
      </div>
      <div className="bg-border/60 my-1 h-px" />
      <button
        type="button"
        disabled={primaryDisabled}
        onClick={onPrimaryAction}
        className="hover:bg-accent flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] transition-colors disabled:opacity-50"
      >
        {primaryLabel === "Workspace settings" ? (
          <Settings className="text-muted-foreground size-4 shrink-0" />
        ) : (
          <ArrowRight className="text-muted-foreground size-4 shrink-0" />
        )}
        {primaryLabel}
      </button>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard
            .writeText(relayUrl)
            .then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1_500);
            })
            .catch((error: unknown) => {
              console.warn("[Workspace] Could not copy relay URL:", error);
            });
        }}
        className="hover:bg-accent flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] transition-colors"
      >
        {copied ? (
          <Check className="text-muted-foreground size-4 shrink-0" />
        ) : (
          <Copy className="text-muted-foreground size-4 shrink-0" />
        )}
        {copied ? "Copied relay URL" : "Copy relay URL"}
      </button>
    </PopoverContent>
  );
}
