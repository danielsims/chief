import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workspaceInviteClaims = sqliteTable(
  "workspace_invite_claims",
  {
    invite_id: text("invite_id").notNull(),
    user_id: text("user_id").notNull(),
    claimed_at: text("claimed_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.invite_id, table.user_id] })],
);
