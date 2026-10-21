import { useState } from "react";
import { Trash2 } from "lucide-react";

import { workspaceBoardId } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";

import { DatabaseDeleteDialog } from "../databases/database-delete-dialog";
import { DatabaseView } from "../databases/database-view";
import {
  announceDatabasesChanged,
  useDatabases,
} from "../databases/use-database";

/** A database opened from a channel's artifacts, under the channel's tabs. */
export function ChannelDatabaseViewer({
  databaseId,
  conversationId,
  onClosed,
}: {
  databaseId: string;
  conversationId: string;
  /** Called once it's been deleted. */
  onClosed: () => void;
}) {
  const { databases, loaded } = useDatabases(conversationId);
  const [deleting, setDeleting] = useState(false);
  const database = databases.find((candidate) => candidate.id === databaseId);
  if (loaded && !database)
    return (
      <div className="text-muted-foreground grid flex-1 place-items-center px-6 text-center text-sm">
        This isn’t available in this channel.
      </div>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col pt-4">
      <DatabaseView
        key={databaseId}
        databaseId={databaseId}
        actions={
          database && database.id !== workspaceBoardId ? (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Delete"
              aria-label={`Delete ${database.name}`}
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={14} />
            </Button>
          ) : null
        }
      />
      {deleting && database ? (
        <DatabaseDeleteDialog
          database={database}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            announceDatabasesChanged();
            onClosed();
          }}
        />
      ) : null}
    </div>
  );
}
