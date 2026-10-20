import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const mcpConnections = sqliteTable("mcp_connections", {
  id: text("id").primaryKey(),
  document_json: text("document_json").notNull(),
  updated_at: integer("updated_at").notNull(),
});

/** Sealed per connection; never selected together with documents. */
export const mcpCredentials = sqliteTable("mcp_credentials", {
  connection_id: text("connection_id").primaryKey(),
  sealed: text("sealed").notNull(),
  updated_at: integer("updated_at").notNull(),
});

/**
 * One row per browser sign-in in flight. Only hashes of the nonce, start
 * token and browser binding are stored, so a storage read cannot complete a
 * flow.
 */
export const mcpOAuthRequests = sqliteTable("mcp_oauth_requests", {
  nonce_hash: text("nonce_hash").primaryKey(),
  start_hash: text("start_hash").notNull().unique(),
  connection_id: text("connection_id").notNull(),
  user_id: text("user_id").notNull(),
  authorization_url: text("authorization_url").notNull(),
  binding_hash: text("binding_hash"),
  expires_at: integer("expires_at").notNull(),
});
