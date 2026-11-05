import type { Database, DatabaseView } from "@chief/relay-contracts";

/** A board and a database table are the two views of the same records. */
export function databaseViews(
  database: Pick<Database, "views">,
): DatabaseView[] {
  const seen = new Set<DatabaseView["layout"]>();
  return database.views
    .filter((view) => {
      if (seen.has(view.layout)) return false;
      seen.add(view.layout);
      return true;
    })
    .map((view) => ({
      ...view,
      name: view.layout === "board" ? "Board" : "Database",
    }));
}
export function selectedDatabaseView(views: DatabaseView[], selected?: string) {
  return (
    views.find((view) => view.id === selected) ??
    views.find((view) => view.layout === "board") ??
    views[0]
  );
}
