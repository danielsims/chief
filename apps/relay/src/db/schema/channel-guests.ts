import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const channelGuests = sqliteTable("channel_guests", {
  guest_id: text("guest_id").primaryKey(),
  conversation_id: text("conversation_id").notNull(),
  name: text("name").notNull(),
  about: text("about"),
  /** Relay-hosted profile image URL, when the agent supplied one. */
  avatar_url: text("avatar_url"),
  token_hash: text("token_hash").notNull(),
  status: text("status").notNull(),
  wake: text("wake").notNull(),
  webhook_url: text("webhook_url"),
  /** Encrypted with RELAY_SECRET_KEY; never returned by any API. */
  webhook_authorization: text("webhook_authorization"),
  /** Encrypted Standard Webhooks signing key, base64. */
  webhook_secret: text("webhook_secret"),
  created_at: text("created_at").notNull(),
  removed_at: text("removed_at"),
  last_seen_at: text("last_seen_at"),
  post_window_started_at: text("post_window_started_at"),
  post_window_count: integer("post_window_count").notNull().default(0),
});

/** Threads a guest started or replied in; replies there wake the guest. */
export const channelGuestThreads = sqliteTable(
  "channel_guest_threads",
  {
    guest_id: text("guest_id").notNull(),
    thread_root_id: text("thread_root_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.guest_id, table.thread_root_id] })],
);

/** MCP Events webhook subscriptions (ChatGPT, dots). */
export const channelGuestSubscriptions = sqliteTable(
  "channel_guest_subscriptions",
  {
    subscription_id: text("subscription_id").primaryKey(),
    guest_id: text("guest_id").notNull(),
    wake: text("wake").notNull(),
    url: text("url").notNull(),
    /** Encrypted `whsec_` signing secret supplied by the subscriber. */
    secret: text("secret").notNull(),
    refresh_before: text("refresh_before").notNull(),
    created_at: text("created_at").notNull(),
  },
);

export const channelGuestOutbox = sqliteTable("channel_guest_outbox", {
  delivery_id: text("delivery_id").primaryKey(),
  guest_id: text("guest_id").notNull(),
  subscription_id: text("subscription_id"),
  payload_json: text("payload_json").notNull(),
  attempts: integer("attempts").notNull().default(0),
  next_attempt_at: text("next_attempt_at").notNull(),
  created_at: text("created_at").notNull(),
});
