import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const channelMembers = sqliteTable(
  "channel_members",
  {
    conversation_id: text("conversation_id").notNull(),
    principal_kind: text("principal_kind").notNull(),
    principal_id: text("principal_id").notNull(),
    role: text("role").notNull(),
    joined_at: text("joined_at").notNull(),
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
