import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const channelMembershipBatches = sqliteTable(
  "channel_membership_batches",
  {
    command_id: text("command_id").primaryKey(),
    conversation_id: text("conversation_id").notNull(),
    event_json: text("event_json").notNull(),
    published: integer("published").notNull().default(0),
  },
);
