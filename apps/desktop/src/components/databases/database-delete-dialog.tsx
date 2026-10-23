import { toast } from "sonner";

import type { Database } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@chief/ui/components/dialog";

import { parseRelayError } from "../../lib/relay-runtime-errors";
import { useRelaySession } from "../../lib/relay-session-context";

/** Asks before a database and its rows are deleted for good. */
export function DatabaseDeleteDialog({
  database,
  onClose,
  onDeleted,
}: {
  database: Database;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { client } = useRelaySession();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[calc(100%-32px)] max-w-[400px] gap-3 rounded-xl p-5">
        <DialogTitle className="text-[15px] font-medium">
          Delete {database.name}?
        </DialogTitle>
        <p className="text-muted-foreground text-[13px] leading-5">
          Everything in it goes too. This can't be undone.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              onClose();
              void client?.databases
                .remove(database.id)
                .then(onDeleted, (cause) =>
                  toast.error(
                    parseRelayError(cause).message || "Couldn't delete that.",
                  ),
                );
            }}
          >
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
