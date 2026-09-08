import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const receipts = sqliteTable("receipts", {
  command_id: text("command_id").primaryKey(),
  job_json: text("job_json").notNull(),
});
