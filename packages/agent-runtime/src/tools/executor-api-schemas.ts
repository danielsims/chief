import { z } from "zod";

import type { JsonObject } from "@chief/relay-contracts";
import { isJsonObject, isJsonString } from "@chief/relay-contracts";

export const executorManifestSchema = z.object({
  connection: z.object({
    apiBaseUrl: z.string(),
    auth: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("bearer"), token: z.string() }),
      z.object({ kind: z.literal("oauth"), accessToken: z.string() }),
      z.object({
        kind: z.literal("basic"),
        username: z.string().optional(),
        password: z.string(),
      }),
    ]),
  }),
});
export type ExecutorManifest = z.infer<typeof executorManifestSchema>;
export const emptyResponseSchema = z.unknown();

export const integrationSchema = z.object({
  slug: z.string(),
  name: z.string().optional(),
  displayUrl: z.string().optional(),
  authMethods: z
    .array(
      z.object({
        kind: z.string().optional(),
        template: z.string().optional(),
        placements: z
          .array(
            z.object({
              carrier: z.string().optional(),
              name: z.string().optional(),
              prefix: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});
export const connectionSchema = z.object({
  owner: z.enum(["org", "user"]),
  integration: z.string(),
  name: z.string(),
  identityLabel: z.string().nullable().optional(),
  lastHealth: z.object({ status: z.string().optional() }).nullable().optional(),
});
export const oauthClientSchema = z.object({
  owner: z.enum(["org", "user"]),
  slug: z.string(),
});
export const oauthStartSchema = z.object({
  status: z.enum(["connected", "redirect"]),
  authorizationUrl: z.string().optional(),
  state: z.string().optional(),
});
export const oauthResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  errorDetails: z.string().optional(),
});
export const toolSchema = z.object({
  address: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  requiresApproval: z.boolean().nullable().optional(),
});
export const toolSchemaViewSchema = z.object({
  inputSchema: z
    .object({
      properties: z
        .record(z.string(), z.object({ $ref: z.string().optional() }))
        .optional(),
      required: z.string().array().optional(),
    })
    .optional(),
});
export const executionResponseSchema = z.object({
  status: z.enum(["completed", "paused"]),
  text: z.string(),
  structured: z.unknown(),
  isError: z.boolean().optional(),
});
export const policySchema = z.object({
  id: z.string(),
  owner: z.enum(["org", "user"]),
  pattern: z.string(),
  action: z.enum(["approve", "require_approval", "block"]),
});
export const integrationListSchema = integrationSchema.array();
export const connectionListSchema = connectionSchema.array();
export const oauthClientListSchema = oauthClientSchema.array();
export const toolListSchema = toolSchema.array();
export const nullableOauthResultSchema = oauthResultSchema.nullable();

export interface GoogleAnalyticsAccountData {
  accountSummaries: GoogleAnalyticsAccountSummary[];
}
interface GoogleAnalyticsAccountSummary {
  displayName?: string;
  propertySummaries: GoogleAnalyticsPropertySummary[];
}
interface GoogleAnalyticsPropertySummary {
  displayName?: string;
  property?: string;
}

export function googleAnalyticsAccountData(
  value: JsonObject,
): GoogleAnalyticsAccountData {
  const summaries = value.accountSummaries;
  if (!Array.isArray(summaries)) return { accountSummaries: [] };
  return {
    accountSummaries: summaries.flatMap((summary) => {
      if (!isJsonObject(summary)) return [];
      const account = summary;
      const propertySummaries = Array.isArray(account.propertySummaries)
        ? account.propertySummaries.flatMap((entry) => {
            if (!isJsonObject(entry)) return [];
            const property = entry;
            return [
              {
                displayName: isJsonString(property.displayName)
                  ? property.displayName
                  : undefined,
                property: isJsonString(property.property)
                  ? property.property
                  : undefined,
              },
            ];
          })
        : [];
      return [
        {
          displayName: isJsonString(account.displayName)
            ? account.displayName
            : undefined,
          propertySummaries,
        },
      ];
    }),
  };
}
