import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const members = sqliteTable(
  "members",
  {
    principal_kind: text("principal_kind").notNull(),
    principal_id: text("principal_id").notNull(),
    role: text("role").notNull(),
    created_at: text("created_at").notNull(),
    display_name: text("display_name"),
  },
  (table) => [
    primaryKey({ columns: [table.principal_kind, table.principal_id] }),
  ],
);
