import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const channelMembershipEvents = sqliteTable(
  "channel_membership_events",
  {
    conversation_id: text("conversation_id").notNull(),
    principal_kind: text("principal_kind").notNull(),
    principal_id: text("principal_id").notNull(),
    event_json: text("event_json").notNull(),
    published: integer("published").notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [
        table.conversation_id,
        table.principal_kind,
        table.principal_id,
      ],
    }),
  ],
);
