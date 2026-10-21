import { useParams } from "react-router";

import { DatabaseView } from "../components/databases/database-view";
import { useDatabases } from "../components/databases/use-database";
import { PageHeader } from "../components/page-header";

/** A database that belongs to the whole workspace rather than a channel. */
export function ArtifactDatabasePage() {
  const { databaseId = "" } = useParams();
  const { databases } = useDatabases();
  const database = databases.find((candidate) => candidate.id === databaseId);
  return (
    <div className="-mx-8 -mb-8 flex h-[calc(100vh-48px)] min-w-0 flex-col overflow-hidden">
      <PageHeader title={database?.name ?? "Database"} />
      <DatabaseView key={databaseId} databaseId={databaseId} />
    </div>
  );
}
