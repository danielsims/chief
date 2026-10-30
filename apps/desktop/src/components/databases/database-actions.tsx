import { useState } from "react";
import { MoreVertical, Trash2 } from "lucide-react";

import type { Database } from "@chief/relay-contracts";
import { canDeleteDatabase } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@chief/ui/components/dropdown-menu";

import { useAuth } from "../../lib/auth/auth-context";
import { useWorkspaceRole } from "../../lib/workspace-role";
import { DatabaseDeleteDialog } from "./database-delete-dialog";

/** Board and table toolbars act on the same underlying database. */
export function DatabaseActions({
  database,
  onDeleted,
}: {
  database: Database;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const { user } = useAuth();
  const role = useWorkspaceRole();
  if (
    !canDeleteDatabase(
      database,
      user && role ? { userId: user.id, role } : null,
    )
  )
    return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Database actions"
            title="Database actions"
          >
            <MoreVertical size={15} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem
            className="text-destructive"
            onSelect={() => setDeleting(true)}
          >
            <Trash2 size={14} /> Delete database
          </DropdownMenuItem>
          <p className="text-muted-foreground px-2 pt-1 pb-2 text-[11px] leading-4">
            Deletes the database and all its views, including boards.
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
      {deleting ? (
        <DatabaseDeleteDialog
          database={database}
          onClose={() => setDeleting(false)}
          onDeleted={onDeleted}
        />
      ) : null}
    </>
  );
}
