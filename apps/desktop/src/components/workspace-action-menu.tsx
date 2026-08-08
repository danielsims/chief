import { Plus } from "lucide-react";

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
  onAddWorkspace,
  onPrimaryAction,
}: {
  primaryLabel: "Open workspace" | "Workspace settings";
  primaryDisabled?: boolean;
  onAddWorkspace: () => void;
  onPrimaryAction: () => void;
}) {
  return (
    <PopoverContent
      side="right"
      align="start"
      sideOffset={8}
      className="w-52 p-1.5"
      onOpenAutoFocus={(event) => event.preventDefault()}
    >
      <button
        type="button"
        disabled={primaryDisabled}
        onClick={onPrimaryAction}
        className="hover:bg-accent flex h-9 w-full items-center rounded-lg px-2 text-left text-[13px] transition-colors disabled:opacity-50"
      >
        {primaryLabel}
      </button>
      <div className="bg-border/60 my-1 h-px" />
      <button
        type="button"
        onClick={onAddWorkspace}
        className="hover:bg-accent flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] transition-colors"
      >
        <Plus size={13} />
        Add a workspace
      </button>
    </PopoverContent>
  );
}
