import { useState } from "react";

import type { Database } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@chief/ui/components/dialog";

import { parseRelayError } from "../../lib/relay-runtime-errors";
import { useRelaySession } from "../../lib/relay-session-context";
import { forgetDatabase } from "./use-database";

/** Database views, including boards, are deleted with their database. */
export function DatabaseDeleteDialog({
  database,
  onClose,
  onDeleted,
}: {
  database: Database;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { client, snapshot } = useRelaySession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remove = async () => {
    if (!client || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await client.databases.remove(database.id);
      if (!result.deleted)
        throw new Error("The database couldn't be deleted. Try again.");
      forgetDatabase(database.id, snapshot?.id);
      onDeleted();
      onClose();
    } catch (cause) {
      setError(
        parseRelayError(cause).message ||
          "Couldn't delete the database. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className="w-[calc(100%-32px)] max-w-[400px] gap-3 rounded-xl p-5"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogTitle className="text-[15px] font-medium">
          Delete database?
        </DialogTitle>
        <DialogDescription className="text-[13px] leading-5">
          This will delete “{database.name}”, all its rows and all associated
          views, including boards. This can't be undone.
        </DialogDescription>
        {error ? (
          <p role="alert" className="text-destructive text-[13px]">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={!client || busy}
            onClick={() => void remove()}
          >
            {busy ? "Deleting…" : "Delete database"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
