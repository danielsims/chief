import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const socketTickets = sqliteTable("socket_tickets", {
  ticket_hash: text("ticket_hash").primaryKey(),
  principal_json: text("principal_json").notNull(),
  expires_at: text("expires_at").notNull(),
});
