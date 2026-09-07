import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const jobs = sqliteTable("jobs", {
  job_id: text("job_id").primaryKey(),
  job_json: text("job_json").notNull(),
  status: text("status").notNull(),
  available_at: text("available_at").notNull(),
  lease_token: text("lease_token"),
  lease_expires_at: text("lease_expires_at"),
  updated_at: text("updated_at").notNull(),
});
