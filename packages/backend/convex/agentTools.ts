import { v } from "convex/values";

import { internal } from "./_generated/api";
import {
  action,
  httpAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";

const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(init?.headers ?? {}),
    },
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function siteUrl(): string {
  const value = process.env.CONVEX_SITE_URL;
  if (!value) throw new Error("CONVEX_SITE_URL is unavailable.");
  return value.replace(/\/$/, "");
}

/**
 * Registers the opaque credential that Executor will hold for this workspace.
 * The raw value is never persisted in Convex and never reaches an agent.
 */
export const registerCapability = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const organizationId = identity?.organizationId as string | undefined;
    if (!identity || !organizationId) {
      throw new Error("No active workspace. Sign out and back in.");
    }
    if (!CAPABILITY_PATTERN.test(args.token)) {
      throw new Error("Invalid agent capability.");
    }

    await ctx.runMutation(internal.agentTools.replaceCapability, {
      organizationId,
      tokenHash: await sha256(args.token),
    });
    return { apiBaseUrl: siteUrl() };
  },
});

export const replaceCapability = internalMutation({
  args: { organizationId: v.string(), tokenHash: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentCapability")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    const current = existing.find((row) => row.tokenHash === args.tokenHash);
    if (current) return current._id;
    for (const row of existing) await ctx.db.delete(row._id);
    return ctx.db.insert("agentCapability", {
      organizationId: args.organizationId,
      tokenHash: args.tokenHash,
      createdAt: Date.now(),
    });
  },
});

export const organizationForToken = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const capability = await ctx.db
      .query("agentCapability")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    return capability?.organizationId ?? null;
  },
});

export const connectedSources = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const channels = await ctx.db
      .query("channel")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    return Promise.all(
      channels
        .filter((channel) => channel.status === "connected")
        .map(async (channel) => {
          const credential = await ctx.db
            .query("credential")
            .withIndex("by_organization_provider", (q) =>
              q
                .eq("organizationId", args.organizationId)
                .eq("provider", channel.provider),
            )
            .unique();
          const snapshot = await ctx.db
            .query("analyticsSnapshot")
            .withIndex("by_organization_provider", (q) =>
              q
                .eq("organizationId", args.organizationId)
                .eq("provider", channel.provider),
            )
            .unique();
          const live = Boolean(credential);
          return {
            provider: channel.provider,
            category: channel.category ?? "other",
            name: channel.displayName,
            id: channel.externalId ?? null,
            lastSyncedAt: channel.lastSyncAt ?? null,
            mode: live
              ? "live"
              : snapshot
                ? "cached-snapshot"
                : "metadata-only",
            capturedAt: snapshot?.capturedAt ?? null,
            availableMetrics: live
              ? [
                  "activeUsers",
                  "newUsers",
                  "sessions",
                  "engagedSessions",
                  "screenPageViews",
                  "eventCount",
                  "keyEvents",
                  "totalRevenue",
                  "userEngagementDuration",
                ]
              : snapshot?.series?.length
                ? ["activeUsers"]
                : [],
            availableDimensions: live
              ? [
                  "date",
                  "dateHour",
                  "country",
                  "city",
                  "deviceCategory",
                  "sessionDefaultChannelGroup",
                  "sessionSource",
                  "sessionMedium",
                  "pagePath",
                  "pageTitle",
                  "eventName",
                ]
              : snapshot?.series?.length
                ? ["date"]
                : [],
          };
        }),
    );
  },
});

async function organizationFromRequest(
  ctx: Parameters<Parameters<typeof httpAction>[0]>[0],
  request: Request,
): Promise<string | null> {
  const authorization = request.headers.get("Authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(authorization);
  if (!match) return null;
  return ctx.runQuery(internal.agentTools.organizationForToken, {
    tokenHash: await sha256(match[1]!),
  });
}

export const openApiSpec = httpAction(async (_ctx, request) => {
  const origin = new URL(request.url).origin;
  return json({
    openapi: "3.1.0",
    info: {
      title: "Marketer Agent Tools",
      version: "1.0.0",
      description:
        "Workspace-scoped marketing data exposed to agents through Executor.",
    },
    servers: [{ url: origin }],
    security: [{ workspaceCapability: [] }],
    paths: {
      "/agent-tools/sources": {
        get: {
          operationId: "sources.list",
          summary: "List connected marketing data sources",
          description:
            "Call this before reporting so you know which providers and accounts are connected to the current workspace.",
          responses: {
            "200": {
              description: "Connected sources",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      sources: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Source" },
                      },
                    },
                    required: ["sources"],
                  },
                },
              },
            },
          },
        },
      },
      "/agent-tools/analytics/report": {
        post: {
          operationId: "analytics.runReport",
          summary: "Run an analytics report",
          description:
            "Reads the workspace's connected analytics provider. Dates accept YYYY-MM-DD or GA4 relative dates such as 7daysAgo, yesterday, and today.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AnalyticsReportRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Normalized analytics rows",
              content: {
                "application/json": {
                  schema: { type: "object", additionalProperties: true },
                },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        workspaceCapability: { type: "http", scheme: "bearer" },
      },
      schemas: {
        Source: {
          type: "object",
          properties: {
            provider: { type: "string" },
            category: { type: "string" },
            name: { type: "string" },
            id: { type: ["string", "null"] },
            lastSyncedAt: { type: ["number", "null"] },
            mode: {
              type: "string",
              enum: ["live", "cached-snapshot", "metadata-only"],
            },
            capturedAt: { type: ["number", "null"] },
            availableMetrics: { type: "array", items: { type: "string" } },
            availableDimensions: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: [
            "provider",
            "category",
            "name",
            "id",
            "lastSyncedAt",
            "mode",
            "capturedAt",
            "availableMetrics",
            "availableDimensions",
          ],
        },
        AnalyticsReportRequest: {
          type: "object",
          additionalProperties: false,
          properties: {
            provider: {
              type: "string",
              enum: ["google-analytics"],
              default: "google-analytics",
            },
            startDate: { type: "string", examples: ["7daysAgo"] },
            endDate: { type: "string", examples: ["yesterday"] },
            metrics: {
              type: "array",
              minItems: 1,
              items: {
                type: "string",
                enum: [
                  "activeUsers",
                  "newUsers",
                  "sessions",
                  "engagedSessions",
                  "screenPageViews",
                  "eventCount",
                  "keyEvents",
                  "totalRevenue",
                  "userEngagementDuration",
                ],
              },
            },
            dimensions: {
              type: "array",
              default: [],
              items: {
                type: "string",
                enum: [
                  "date",
                  "dateHour",
                  "country",
                  "city",
                  "deviceCategory",
                  "sessionDefaultChannelGroup",
                  "sessionSource",
                  "sessionMedium",
                  "pagePath",
                  "pageTitle",
                  "eventName",
                ],
              },
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 10000,
              default: 100,
            },
          },
          required: ["startDate", "endDate", "metrics"],
        },
      },
    },
  });
});

export const listSources = httpAction(async (ctx, request) => {
  const organizationId = await organizationFromRequest(ctx, request);
  if (!organizationId) return json({ error: "Unauthorized" }, { status: 401 });
  const sources = await ctx.runQuery(internal.agentTools.connectedSources, {
    organizationId,
  });
  return json({ sources });
});

export const runAnalyticsReport = httpAction(async (ctx, request) => {
  const organizationId = await organizationFromRequest(ctx, request);
  if (!organizationId) return json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Request body must be JSON." }, { status: 400 });
  }
  if (body.provider !== undefined && body.provider !== "google-analytics") {
    return json({ error: "Unsupported analytics provider." }, { status: 400 });
  }
  try {
    const result = await ctx.runAction(
      internal.googleAnalytics.runReportForOrganization,
      {
        organizationId,
        startDate: String(body.startDate ?? ""),
        endDate: String(body.endDate ?? ""),
        metrics: Array.isArray(body.metrics) ? body.metrics.map(String) : [],
        dimensions: Array.isArray(body.dimensions)
          ? body.dimensions.map(String)
          : [],
        limit: typeof body.limit === "number" ? body.limit : 100,
      },
    );
    return json(result);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
});
