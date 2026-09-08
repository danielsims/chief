import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workspaceInvites = sqliteTable("workspace_invites", {
  invite_id: text("invite_id").primaryKey(),
  secret_hash: text("secret_hash").notNull(),
  conversation_id: text("conversation_id"),
  created_by_user_id: text("created_by_user_id").notNull(),
  expires_at: text("expires_at").notNull(),
  use_count: integer("use_count").notNull().default(0),
  revoked_at: text("revoked_at"),
  created_at: text("created_at").notNull(),
});
