import { DatabaseView } from "../databases/database-view";
import { useDatabases } from "../databases/use-database";

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
        onDeleted={onClosed}
      />
    </div>
  );
}
