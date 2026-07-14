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

/**
 * Lets the local runtime prove that an opaque capability belongs to the
 * Better Auth organization claimed by the desktop client. No user or source
 * data is returned through this bootstrap endpoint.
 */
export const capabilityIdentity = httpAction(async (ctx, request) => {
  const organizationId = await organizationFromRequest(ctx, request);
  if (!organizationId) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  return json({ organizationId });
});

export const openApiSpec = httpAction(async (_ctx, request) => {
  const origin = new URL(request.url).origin;
  return json({
    openapi: "3.1.0",
    info: {
      title: "Chief Agent Tools",
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
      "/agent-tools/ui/chart": {
        post: {
          operationId: "ui.presentChart",
          summary: "Present a line chart in the conversation",
          description:
            "Returns a typed chart UI part for Chief to render inline in chat. Use this instead of creating SVG, HTML, image, or other chart files.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PresentChartRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Typed data-chart UI part",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ChartDataPart" },
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
        ChartPoint: {
          type: "object",
          additionalProperties: false,
          properties: {
            x: { type: "string", maxLength: 80 },
            value: { type: "number" },
          },
          required: ["x", "value"],
        },
        ChartSeries: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: "string", maxLength: 120 },
            points: {
              type: "array",
              minItems: 2,
              maxItems: 370,
              items: { $ref: "#/components/schemas/ChartPoint" },
            },
          },
          required: ["label", "points"],
        },
        PresentChartRequest: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", maxLength: 120 },
            subtitle: { type: "string", maxLength: 180 },
            xLabel: { type: "string", maxLength: 80 },
            yLabel: { type: "string", maxLength: 80 },
            series: {
              type: "array",
              minItems: 1,
              maxItems: 4,
              items: { $ref: "#/components/schemas/ChartSeries" },
            },
          },
          required: ["title", "yLabel", "series"],
        },
        ChartDataPart: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["data-chart"] },
            data: { type: "object", additionalProperties: true },
          },
          required: ["type", "data"],
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

function shortString(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maximum)
    : undefined;
}

export const presentChart = httpAction(async (ctx, request) => {
  const organizationId = await organizationFromRequest(ctx, request);
  if (!organizationId) return json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const title = shortString(body.title, 120);
  const yLabel = shortString(body.yLabel, 80);
  if (!title || !yLabel || !Array.isArray(body.series)) {
    return json(
      { error: "A title, yLabel, and at least one series are required." },
      { status: 400 },
    );
  }

  const series = body.series.slice(0, 4).flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const record = candidate as Record<string, unknown>;
    const label = shortString(record.label, 120);
    if (!label || !Array.isArray(record.points)) return [];
    const points = record.points.slice(0, 370).flatMap((point) => {
      if (!point || typeof point !== "object") return [];
      const value = point as Record<string, unknown>;
      const x = shortString(value.x, 80);
      return x &&
        typeof value.value === "number" &&
        Number.isFinite(value.value)
        ? [{ x, value: value.value }]
        : [];
    });
    return points.length >= 2
      ? [{ id: `series-${index + 1}`, label, points }]
      : [];
  });
  if (series.length === 0) {
    return json(
      { error: "Each chart series needs at least two valid points." },
      { status: 400 },
    );
  }

  return json({
    type: "data-chart",
    data: {
      kind: "line",
      title,
      ...(shortString(body.subtitle, 180)
        ? { subtitle: shortString(body.subtitle, 180) }
        : {}),
      ...(shortString(body.xLabel, 80)
        ? { xLabel: shortString(body.xLabel, 80) }
        : {}),
      yLabel,
      series,
    },
  });
});
