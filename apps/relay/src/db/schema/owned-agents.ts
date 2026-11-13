import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * Connect codes a member copies into a setup prompt. A code is not a
 * credential: it only routes a pending request to that member's approval
 * card. Only its SHA-256 is stored.
 */
export const ownedAgentConnectCodes = sqliteTable("owned_agent_connect_codes", {
  code_hash: text("code_hash").primaryKey(),
  user_id: text("user_id").notNull(),
  request_count: integer("request_count").notNull().default(0),
  created_at: text("created_at").notNull(),
  expires_at: text("expires_at").notNull(),
  invalidated_at: text("invalidated_at"),
});

/** Device authorization requests (RFC 8628) waiting for their member. */
export const ownedAgentRequests = sqliteTable("owned_agent_requests", {
  request_id: text("request_id").primaryKey(),
  code_hash: text("code_hash").notNull(),
  /** The only person who may approve: the member bound to the connect code. */
  user_id: text("user_id").notNull(),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  /** The key the agent generated. Every poll must be signed with it. */
  pubkey: text("pubkey").notNull(),
  device_code_hash: text("device_code_hash").notNull().unique(),
  user_code: text("user_code").notNull(),
  status: text("status").notNull(),
  agent_id: text("agent_id"),
  poll_interval: integer("poll_interval").notNull(),
  last_polled_at: text("last_polled_at"),
  created_at: text("created_at").notNull(),
  expires_at: text("expires_at").notNull(),
  decided_at: text("decided_at"),
});

/**
 * An approved agent. Only its name and owner are stored; the handle people
 * see is computed from the owner's current username.
 */
export const ownedAgents = sqliteTable("owned_agents", {
  agent_id: text("agent_id").primaryKey(),
  owner_user_id: text("owner_user_id").notNull(),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  pubkey: text("pubkey").notNull().unique(),
  status: text("status").notNull(),
  created_at: text("created_at").notNull(),
  revoked_at: text("revoked_at"),
  revoked_by: text("revoked_by"),
  last_seen_at: text("last_seen_at"),
  post_window_started_at: text("post_window_started_at"),
  post_window_count: integer("post_window_count").notNull().default(0),
});

/** Channels an owned agent was added to. A new agent has none. */
export const ownedAgentChannels = sqliteTable(
  "owned_agent_channels",
  {
    agent_id: text("agent_id").notNull(),
    conversation_id: text("conversation_id").notNull(),
    added_by: text("added_by").notNull(),
    added_at: text("added_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.agent_id, table.conversation_id] })],
);

/** Threads an owned agent posted in; replies there wake it. */
export const ownedAgentThreads = sqliteTable(
  "owned_agent_threads",
  {
    agent_id: text("agent_id").notNull(),
    thread_root_id: text("thread_root_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.agent_id, table.thread_root_id] })],
);

/** Single-use challenges an agent signs to obtain a short-lived credential. */
export const ownedAgentChallenges = sqliteTable("owned_agent_challenges", {
  challenge_hash: text("challenge_hash").primaryKey(),
  agent_id: text("agent_id").notNull(),
  expires_at: text("expires_at").notNull(),
});
