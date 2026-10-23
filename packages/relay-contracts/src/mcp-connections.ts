import { z } from "zod";

import { jsonObjectSchema, jsonValueSchema } from "./json";

/**
 * A workspace's connection to one remote MCP server. Chief shows these as
 * plugins. Credentials never appear in any of these shapes; they stay sealed
 * inside the workspace.
 */
export const mcpConnectionIdSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u);

export const mcpToolSummarySchema = z.object({
  name: z.string().min(1).max(128),
  title: z.string().max(200).optional(),
  description: z.string().max(4_000).default(""),
  inputSchema: jsonObjectSchema.default({}),
  readOnly: z.boolean(),
  destructive: z.boolean(),
});

/** Chief's own tools that automations can use as steps. */
export const automationToolCatalogSchema = z.object({
  tools: z.array(mcpToolSummarySchema.omit({ destructive: true })),
});

export const mcpConnectionAuthSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("headers"),
    headerNames: z.array(z.string()).max(8),
  }),
  z.object({
    kind: z.literal("oauth"),
    clientRegistration: z
      .enum(["metadata_document", "dynamic", "manual"])
      .optional(),
  }),
]);

export const mcpConnectionSchema = z.object({
  id: mcpConnectionIdSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().max(1_000).default(""),
  url: z.string().url(),
  domain: z.string().max(253).optional(),
  iconUrl: z.string().url().optional(),
  catalogId: z.string().max(128).optional(),
  auth: mcpConnectionAuthSchema,
  status: z.enum(["needs_auth", "connected", "error"]),
  error: z.string().max(500).optional(),
  tools: z.array(mcpToolSummarySchema).max(256).default([]),
  toolsFetchedAt: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const headerSchema = z.object({
  // RFC 9110 token characters only, so a name can never split a header line.
  name: z
    .string()
    .trim()
    .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/u),
  value: z
    .string()
    .min(1)
    .max(8_192)
    .regex(/^[^\r\n\0]*$/u),
});

export const mcpConnectionCreateSchema = z.object({
  id: mcpConnectionIdSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1_000).default(""),
  url: z.string().trim().url().max(2_048),
  domain: z.string().trim().max(253).optional(),
  iconUrl: z.string().trim().url().max(2_048).optional(),
  catalogId: z.string().trim().max(128).optional(),
  auth: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }),
    z.object({ kind: z.literal("oauth") }),
    z.object({
      kind: z.literal("headers"),
      headers: z.array(headerSchema).min(1).max(8),
    }),
  ]),
});

export const mcpConnectionClientSchema = z.object({
  clientId: z.string().trim().min(1).max(512),
  clientSecret: z.string().trim().min(1).max(4_096).optional(),
});

export const mcpConnectionListSchema = z.object({
  connections: z.array(mcpConnectionSchema).max(100),
});

export const mcpConnectionAuthorizeResultSchema = z.discriminatedUnion(
  "status",
  [
    z.object({
      status: z.literal("connected"),
      connection: mcpConnectionSchema,
    }),
    z.object({ status: z.literal("authorize"), startUrl: z.string().url() }),
    z.object({ status: z.literal("client_required") }),
  ],
);

export const mcpToolCallSchema = z.object({
  connectionId: mcpConnectionIdSchema,
  name: z.string().min(1).max(128),
  arguments: jsonObjectSchema.default({}),
  /** Set by automations: refuse the call unless the tool is still read-only. */
  requireReadOnly: z.boolean().default(false),
});

export const mcpToolCallResultSchema = z.object({
  isError: z.boolean(),
  content: jsonValueSchema,
  truncated: z.boolean(),
});

export type McpConnection = z.infer<typeof mcpConnectionSchema>;
export type McpToolSummary = z.infer<typeof mcpToolSummarySchema>;
export type AutomationChiefTool = z.infer<
  typeof automationToolCatalogSchema
>["tools"][number];
export type McpConnectionCreate = z.infer<typeof mcpConnectionCreateSchema>;
export type McpConnectionAuthorizeResult = z.infer<
  typeof mcpConnectionAuthorizeResultSchema
>;
export type McpToolCall = z.infer<typeof mcpToolCallSchema>;
export type McpToolCallResult = z.infer<typeof mcpToolCallResultSchema>;
