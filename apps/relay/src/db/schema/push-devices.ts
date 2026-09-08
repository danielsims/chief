import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const pushDevices = sqliteTable("push_devices", {
  token: text("token").primaryKey(),
  environment: text("environment").notNull(),
  updated_at: text("updated_at").notNull(),
});
