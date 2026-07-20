/* eslint-disable max-lines */

import { v } from "convex/values";

import { internal } from "./_generated/api";
import {
  action,
  httpAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { convexSiteUrl } from "./env";

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
  return convexSiteUrl().replace(/\/$/, "");
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
          const snapshot = await ctx.db
            .query("analyticsSnapshot")
            .withIndex("by_organization_provider", (q) =>
              q
                .eq("organizationId", args.organizationId)
                .eq("provider", channel.provider),
            )
            .unique();
          return {
            provider: channel.provider,
            category: channel.category ?? "other",
            name: channel.displayName,
            id: channel.externalId ?? null,
            lastSyncedAt: channel.lastSyncAt ?? null,
            mode: snapshot ? "cached-snapshot" : "metadata-only",
            capturedAt: snapshot?.capturedAt ?? null,
            availableMetrics: snapshot?.series?.length ? ["activeUsers"] : [],
            availableDimensions: snapshot?.series?.length ? ["date"] : [],
          };
        }),
    );
  },
});

export const cloudRecords = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => ({
    prospects: await ctx.db
      .query("agentProspect")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect(),
    files: await ctx.db
      .query("agentWorkspaceFile")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect(),
    actions: await ctx.db
      .query("agentAction")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect(),
  }),
});

export const saveCloudProspect = internalMutation({
  args: {
    organizationId: v.string(),
    externalId: v.string(),
    name: v.string(),
    company: v.optional(v.string()),
    source: v.string(),
    sourceUrl: v.string(),
    summary: v.string(),
    relevance: v.union(
      v.literal("high"),
      v.literal("medium"),
      v.literal("low"),
    ),
    status: v.union(
      v.literal("new"),
      v.literal("researching"),
      v.literal("contacted"),
      v.literal("dismissed"),
    ),
    foundAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentProspect")
      .withIndex("by_organization_external", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("externalId", args.externalId),
      )
      .unique();
    const value = { ...args, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, value);
      return existing._id;
    }
    return ctx.db.insert("agentProspect", value);
  },
});

export const saveCloudFile = internalMutation({
  args: {
    organizationId: v.string(),
    externalId: v.string(),
    name: v.string(),
    path: v.string(),
    mimeType: v.string(),
    kind: v.union(v.literal("document"), v.literal("email")),
    content: v.string(),
    versionId: v.string(),
    createdBy: v.union(v.literal("agent"), v.literal("user")),
    sourceAgentId: v.optional(v.string()),
    sourceSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const byId = await ctx.db
      .query("agentWorkspaceFile")
      .withIndex("by_organization_external", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("externalId", args.externalId),
      )
      .unique();
    const byPath = byId
      ? null
      : await ctx.db
          .query("agentWorkspaceFile")
          .withIndex("by_organization_path", (q) =>
            q.eq("organizationId", args.organizationId).eq("path", args.path),
          )
          .unique();
    const existing = byId ?? byPath;
    const now = Date.now();
    const value = {
      ...args,
      externalId: existing?.externalId ?? args.externalId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, value);
      return existing._id;
    }
    return ctx.db.insert("agentWorkspaceFile", value);
  },
});

export const saveCloudAction = internalMutation({
  args: {
    organizationId: v.string(),
    externalId: v.string(),
    agentId: v.string(),
    title: v.string(),
    reason: v.string(),
    sourceId: v.optional(v.string()),
    request: v.optional(v.any()),
    status: v.union(v.literal("open"), v.literal("dismissed")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentAction")
      .withIndex("by_organization_external", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("externalId", args.externalId),
      )
      .unique();
    const now = Date.now();
    const value = {
      ...args,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, value);
      return existing._id;
    }
    return ctx.db.insert("agentAction", value);
  },
});

export const dismissCloudAction = internalMutation({
  args: { organizationId: v.string(), externalId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentAction")
      .withIndex("by_organization_external", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("externalId", args.externalId),
      )
      .unique();
    if (!existing) return false;
    await ctx.db.patch(existing._id, {
      status: "dismissed",
      updatedAt: Date.now(),
    });
    return true;
  },
});

async function organizationFromRequest(
  ctx: Parameters<Parameters<typeof httpAction>[0]>[0],
  request: Request,
): Promise<string | null> {
  const authorization = request.headers.get("Authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(authorization);
  const token = match?.[1];
  if (!token) return null;
  return ctx.runQuery(internal.agentTools.organizationForToken, {
    tokenHash: await sha256(token),
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
      "/agent-tools/records": {
        get: {
          operationId: "records.list",
          summary: "List durable Chief workspace records",
          description:
            "Returns prospects, workspace files, and open setup actions saved by cloud agents.",
          responses: {
            "200": {
              description: "Workspace records",
              content: {
                "application/json": {
                  schema: { type: "object", additionalProperties: true },
                },
              },
            },
          },
        },
      },
      "/agent-tools/prospects": {
        post: {
          operationId: "prospects.save",
          summary: "Save a qualified prospect with direct source evidence",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SaveProspectRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Saved prospect",
              content: {
                "application/json": {
                  schema: { type: "object", additionalProperties: true },
                },
              },
            },
          },
        },
      },
      "/agent-tools/files": {
        post: {
          operationId: "files.save",
          summary: "Save a versioned Markdown workspace file",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SaveFileRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Saved workspace file",
              content: {
                "application/json": {
                  schema: { type: "object", additionalProperties: true },
                },
              },
            },
          },
        },
      },
      "/agent-tools/actions": {
        post: {
          operationId: "actions.raise",
          summary: "Raise one structured user setup action",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RaiseActionRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Saved action",
              content: {
                "application/json": {
                  schema: { type: "object", additionalProperties: true },
                },
              },
            },
          },
        },
      },
      "/agent-tools/integrations/connected": {
        post: {
          operationId: "integrations.markConnected",
          summary: "Mark a verified integration as connected",
          description:
            "Call only after a real provider API request has verified access. This updates Chief's workspace integration state; it does not store credentials or configure the provider.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/MarkConnectedIntegrationRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "The connected workspace integration",
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
        SaveProspectRequest: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string", maxLength: 120 },
            name: { type: "string", minLength: 1, maxLength: 200 },
            company: { type: "string", maxLength: 200 },
            source: { type: "string", minLength: 1, maxLength: 120 },
            sourceUrl: { type: "string", format: "uri", maxLength: 2000 },
            summary: { type: "string", minLength: 1, maxLength: 4000 },
            relevance: {
              type: "string",
              enum: ["high", "medium", "low"],
            },
            status: {
              type: "string",
              enum: ["new", "researching", "contacted", "dismissed"],
              default: "new",
            },
          },
          required: ["name", "source", "sourceUrl", "summary", "relevance"],
        },
        SaveFileRequest: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string", maxLength: 120 },
            name: { type: "string", minLength: 1, maxLength: 240 },
            path: { type: "string", minLength: 1, maxLength: 500 },
            content: { type: "string", minLength: 1, maxLength: 200000 },
            kind: { type: "string", enum: ["document", "email"] },
            sourceAgentId: { type: "string", maxLength: 120 },
            sourceSessionId: { type: "string", maxLength: 200 },
          },
          required: ["name", "path", "content"],
        },
        RaiseActionRequest: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string", maxLength: 120 },
            agentId: { type: "string", maxLength: 120 },
            title: { type: "string", minLength: 1, maxLength: 240 },
            reason: { type: "string", minLength: 1, maxLength: 4000 },
            sourceId: { type: "string", maxLength: 200 },
            request: { type: "object", additionalProperties: true },
          },
          required: ["agentId", "title", "reason"],
        },
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
        MarkConnectedIntegrationRequest: {
          type: "object",
          additionalProperties: false,
          properties: {
            provider: {
              type: "string",
              minLength: 1,
              maxLength: 160,
              description:
                "Canonical provider id, such as google-analytics or google-ads.",
            },
            category: {
              type: "string",
              enum: ["analytics", "ads", "social", "other"],
            },
            displayName: { type: "string", maxLength: 160 },
            externalId: {
              type: "string",
              maxLength: 240,
              description:
                "The verified provider account, property, or workspace id when one exists.",
            },
          },
          required: ["provider", "category"],
        },
        AnalyticsMetricValue: {
          type: "object",
          additionalProperties: false,
          properties: {
            metric: { type: "string", minLength: 1, maxLength: 120 },
            value: { type: "number" },
          },
          required: ["metric", "value"],
        },
        AnalyticsDataset: {
          type: "object",
          additionalProperties: false,
          properties: {
            provider: { type: "string", minLength: 1, maxLength: 160 },
            key: { type: "string", minLength: 1, maxLength: 120 },
            sourceId: { type: "string", maxLength: 240 },
            title: { type: "string", minLength: 1, maxLength: 200 },
            description: { type: "string", maxLength: 2000 },
            capturedAt: { type: "number", readOnly: true },
            metrics: {
              type: "array",
              minItems: 1,
              maxItems: 40,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  key: { type: "string", minLength: 1, maxLength: 120 },
                  label: { type: "string", minLength: 1, maxLength: 160 },
                  format: {
                    type: "string",
                    enum: ["number", "currency", "percent", "duration"],
                  },
                  unit: { type: "string", maxLength: 40 },
                  currency: { type: "string", maxLength: 8 },
                },
                required: ["key", "label", "format"],
              },
            },
            dimensions: {
              type: "array",
              maxItems: 20,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  key: { type: "string", minLength: 1, maxLength: 120 },
                  label: { type: "string", minLength: 1, maxLength: 160 },
                },
                required: ["key", "label"],
              },
            },
            periods: {
              type: "array",
              maxItems: 24,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  key: { type: "string", minLength: 1, maxLength: 120 },
                  label: { type: "string", minLength: 1, maxLength: 160 },
                  startDate: { type: "string", minLength: 1, maxLength: 40 },
                  endDate: { type: "string", minLength: 1, maxLength: 40 },
                  values: {
                    type: "array",
                    maxItems: 40,
                    items: {
                      $ref: "#/components/schemas/AnalyticsMetricValue",
                    },
                  },
                },
                required: ["key", "label", "startDate", "endDate", "values"],
              },
            },
            rows: {
              type: "array",
              maxItems: 1000,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  dimensions: {
                    type: "array",
                    maxItems: 20,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        dimension: {
                          type: "string",
                          minLength: 1,
                          maxLength: 120,
                        },
                        value: { type: "string", maxLength: 500 },
                      },
                      required: ["dimension", "value"],
                    },
                  },
                  values: {
                    type: "array",
                    maxItems: 40,
                    items: {
                      $ref: "#/components/schemas/AnalyticsMetricValue",
                    },
                  },
                },
                required: ["dimensions", "values"],
              },
            },
            series: {
              type: "array",
              maxItems: 12,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string", minLength: 1, maxLength: 120 },
                  metric: { type: "string", minLength: 1, maxLength: 120 },
                  label: { type: "string", minLength: 1, maxLength: 160 },
                  points: {
                    type: "array",
                    maxItems: 370,
                    items: { $ref: "#/components/schemas/ChartPoint" },
                  },
                },
                required: ["id", "metric", "label", "points"],
              },
            },
            charts: {
              type: "array",
              maxItems: 8,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  kind: { type: "string", enum: ["line"] },
                  title: { type: "string", minLength: 1, maxLength: 160 },
                  subtitle: { type: "string", maxLength: 240 },
                  xLabel: { type: "string", maxLength: 80 },
                  yLabel: { type: "string", minLength: 1, maxLength: 80 },
                  series: {
                    type: "array",
                    minItems: 1,
                    maxItems: 4,
                    items: { type: "string", maxLength: 120 },
                  },
                },
                required: ["kind", "title", "yLabel", "series"],
              },
            },
            provenance: {
              type: "object",
              additionalProperties: false,
              properties: {
                operation: { type: "string", maxLength: 240 },
                query: {
                  type: "array",
                  maxItems: 40,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      key: { type: "string", minLength: 1, maxLength: 120 },
                      value: { type: "string", maxLength: 1000 },
                    },
                    required: ["key", "value"],
                  },
                },
                notes: { type: "string", maxLength: 2000 },
              },
            },
          },
          required: [
            "provider",
            "key",
            "title",
            "metrics",
            "dimensions",
            "periods",
          ],
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

export const listCloudRecords = httpAction(async (ctx, request) => {
  const organizationId = await organizationFromRequest(ctx, request);
  if (!organizationId) return json({ error: "Unauthorized" }, { status: 401 });
  const records = await ctx.runQuery(internal.agentTools.cloudRecords, {
    organizationId,
  });
  return json({
    prospects: records.prospects.map((prospect) => ({
      id: prospect.externalId,
      name: prospect.name,
      company: prospect.company,
      source: prospect.source,
      sourceUrl: prospect.sourceUrl,
      summary: prospect.summary,
      relevance: prospect.relevance,
      status: prospect.status,
      foundAt: prospect.foundAt,
    })),
    files: records.files.map((file) => ({
      id: file.externalId,
      name: file.name,
      path: file.path,
      mimeType: file.mimeType,
      kind: file.kind,
      content: file.content,
      versionId: file.versionId,
      createdBy: file.createdBy,
      sourceAgentId: file.sourceAgentId,
      sourceSessionId: file.sourceSessionId,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    })),
    actions: records.actions
      .filter((action) => action.status === "open")
      .map((action) => ({
        id: action.externalId,
        agentId: action.agentId,
        title: action.title,
        reason: action.reason,
        sourceId: action.sourceId,
        request: action.request as unknown,
        status: action.status,
        createdAt: action.createdAt,
      })),
  });
});

async function requestBody(request: Request) {
  try {
    const value = (await request.json()) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export const saveCloudProspectHttp = httpAction(async (ctx, request) => {
  const organizationId = await organizationFromRequest(ctx, request);
  if (!organizationId) return json({ error: "Unauthorized" }, { status: 401 });
  const body = await requestBody(request);
  const name = shortString(body?.name, 200);
  const source = shortString(body?.source, 120);
  const summary = shortString(body?.summary, 4000);
  const sourceUrl = shortString(body?.sourceUrl, 2000);
  const relevance =
    typeof body?.relevance === "string" ? body.relevance : undefined;
  const status = typeof body?.status === "string" ? body.status : "new";
  let parsedUrl: URL | undefined;
  try {
    if (sourceUrl) parsedUrl = new URL(sourceUrl);
  } catch {
    // Rejected below with the same stable message as unsupported protocols.
  }
  if (
    !name ||
    !source ||
    !summary ||
    !parsedUrl ||
    !["http:", "https:"].includes(parsedUrl.protocol) ||
    !relevance ||
    !["high", "medium", "low"].includes(relevance) ||
    !["new", "researching", "contacted", "dismissed"].includes(status)
  ) {
    return json(
      {
        error:
          "A valid name, direct source URL, summary, and relevance are required.",
      },
      { status: 400 },
    );
  }
  const externalId = shortString(body?.id, 120) ?? crypto.randomUUID();
  await ctx.runMutation(internal.agentTools.saveCloudProspect, {
    organizationId,
    externalId,
    name,
    ...(shortString(body?.company, 200)
      ? { company: shortString(body?.company, 200) }
      : {}),
    source,
    sourceUrl: parsedUrl.toString(),
    summary,
    relevance: relevance as "high" | "medium" | "low",
    status: status as "new" | "researching" | "contacted" | "dismissed",
    foundAt: Date.now(),
  });
  return json({ saved: true, id: externalId });
});

export const saveCloudFileHttp = httpAction(async (ctx, request) => {
  const organizationId = await organizationFromRequest(ctx, request);
  if (!organizationId) return json({ error: "Unauthorized" }, { status: 401 });
  const body = await requestBody(request);
  const name = shortString(body?.name, 240);
  const path = shortString(body?.path, 500)?.replace(/^\/+/, "");
  const content =
    typeof body?.content === "string" ? body.content.slice(0, 200_000) : "";
  if (
    !name ||
    !path ||
    !content.trim() ||
    path.includes("..") ||
    path.includes("\\")
  ) {
    return json(
      {
        error:
          "A safe workspace-relative path and non-empty content are required.",
      },
      { status: 400 },
    );
  }
  const externalId = shortString(body?.id, 120) ?? crypto.randomUUID();
  const kind = body?.kind === "email" ? "email" : "document";
  await ctx.runMutation(internal.agentTools.saveCloudFile, {
    organizationId,
    externalId,
    name,
    path,
    content,
    kind,
    mimeType: "text/markdown",
    versionId: crypto.randomUUID(),
    createdBy: "agent",
    ...(shortString(body?.sourceAgentId, 120)
      ? { sourceAgentId: shortString(body?.sourceAgentId, 120) }
      : {}),
    ...(shortString(body?.sourceSessionId, 200)
      ? { sourceSessionId: shortString(body?.sourceSessionId, 200) }
      : {}),
  });
  return json({ saved: true, id: externalId, path });
});

export const saveCloudActionHttp = httpAction(async (ctx, request) => {
  const organizationId = await organizationFromRequest(ctx, request);
  if (!organizationId) return json({ error: "Unauthorized" }, { status: 401 });
  const body = await requestBody(request);
  const agentId = shortString(body?.agentId, 120);
  const title = shortString(body?.title, 240);
  const reason = shortString(body?.reason, 4000);
  if (!agentId || !title || !reason) {
    return json(
      { error: "agentId, title, and reason are required." },
      { status: 400 },
    );
  }
  const externalId = shortString(body?.id, 120) ?? crypto.randomUUID();
  await ctx.runMutation(internal.agentTools.saveCloudAction, {
    organizationId,
    externalId,
    agentId,
    title,
    reason,
    ...(shortString(body?.sourceId, 200)
      ? { sourceId: shortString(body?.sourceId, 200) }
      : {}),
    ...(body?.request && typeof body.request === "object"
      ? { request: body.request }
      : {}),
    status: "open",
  });
  return json({ saved: true, id: externalId });
});

export const dismissCloudActionHttp = httpAction(async (ctx, request) => {
  const organizationId = await organizationFromRequest(ctx, request);
  if (!organizationId) return json({ error: "Unauthorized" }, { status: 401 });
  const body = await requestBody(request);
  const id = shortString(body?.id, 120);
  if (!id) return json({ error: "id is required." }, { status: 400 });
  await ctx.runMutation(internal.agentTools.dismissCloudAction, {
    organizationId,
    externalId: id,
  });
  return json({ dismissed: true, id });
});

function canonicalProvider(provider: string): string {
  if (provider === "analytics.googleapis.com") return "google-analytics";
  if (provider === "googleads.googleapis.com") return "google-ads";
  return provider;
}

export const markIntegrationConnected = httpAction(async (ctx, request) => {
  const organizationId = await organizationFromRequest(ctx, request);
  if (!organizationId) return json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const providerInput = shortString(body.provider, 160);
  const requestedCategory = shortString(body.category, 40);
  if (!providerInput || !requestedCategory) {
    return json(
      { error: "provider and category are required." },
      { status: 400 },
    );
  }
  if (!["analytics", "ads", "social", "other"].includes(requestedCategory)) {
    return json(
      { error: "Unsupported integration category." },
      { status: 400 },
    );
  }

  const provider = canonicalProvider(providerInput);
  const category =
    provider === "google-analytics"
      ? "analytics"
      : provider === "google-ads"
        ? "ads"
        : requestedCategory;
  const displayName = shortString(body.displayName, 160);
  const externalId = shortString(body.externalId, 240);
  const integrationId = await ctx.runMutation(
    internal.integrations.markConnectedForOrganization,
    {
      organizationId,
      provider,
      category,
      ...(displayName ? { displayName } : {}),
      ...(externalId ? { externalId } : {}),
    },
  );

  return json({
    connected: true,
    integration: {
      id: integrationId,
      provider,
      category,
      displayName: displayName ?? provider,
      externalId: externalId ?? null,
    },
  });
});

function shortString(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maximum)
    : undefined;
}

type AnalyticsMetricFormat = "number" | "currency" | "percent" | "duration";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function metricValues(value: unknown) {
  if (!Array.isArray(value) || value.length > 40) return null;
  const values = value.flatMap((item) => {
    const candidate = record(item);
    const metric = shortString(candidate?.metric, 120);
    return metric &&
      typeof candidate?.value === "number" &&
      Number.isFinite(candidate.value)
      ? [{ metric, value: candidate.value }]
      : [];
  });
  return values.length === value.length ? values : null;
}

function analyticsDatasetBody(body: Record<string, unknown> | null) {
  const provider = shortString(body?.provider, 160);
  const key = shortString(body?.key, 120);
  const title = shortString(body?.title, 200);
  if (
    !provider ||
    !key ||
    !title ||
    !Array.isArray(body?.metrics) ||
    body.metrics.length < 1 ||
    body.metrics.length > 40 ||
    !Array.isArray(body.dimensions) ||
    body.dimensions.length > 20 ||
    !Array.isArray(body.periods) ||
    body.periods.length > 24
  ) {
    return null;
  }

  const metrics = body.metrics.flatMap((item) => {
    const candidate = record(item);
    const metricKey = shortString(candidate?.key, 120);
    const label = shortString(candidate?.label, 160);
    const format = shortString(candidate?.format, 20);
    const currency = shortString(candidate?.currency, 8);
    return metricKey &&
      label &&
      format &&
      ["number", "currency", "percent", "duration"].includes(format) &&
      (format !== "currency" || Boolean(currency?.match(/^[A-Z]{3}$/)))
      ? [
          {
            key: metricKey,
            label,
            format: format as AnalyticsMetricFormat,
            ...(shortString(candidate?.unit, 40)
              ? { unit: shortString(candidate?.unit, 40) }
              : {}),
            ...(currency ? { currency } : {}),
          },
        ]
      : [];
  });
  const dimensions = body.dimensions.flatMap((item) => {
    const candidate = record(item);
    const dimensionKey = shortString(candidate?.key, 120);
    const label = shortString(candidate?.label, 160);
    return dimensionKey && label ? [{ key: dimensionKey, label }] : [];
  });
  const periods = body.periods.flatMap((item) => {
    const candidate = record(item);
    const periodKey = shortString(candidate?.key, 120);
    const label = shortString(candidate?.label, 160);
    const startDate = shortString(candidate?.startDate, 40);
    const endDate = shortString(candidate?.endDate, 40);
    const values = metricValues(candidate?.values);
    return periodKey && label && startDate && endDate && values
      ? [{ key: periodKey, label, startDate, endDate, values }]
      : [];
  });
  if (
    metrics.length !== body.metrics.length ||
    dimensions.length !== body.dimensions.length ||
    periods.length !== body.periods.length
  ) {
    return null;
  }

  const rows = Array.isArray(body.rows)
    ? body.rows.slice(0, 1000).flatMap((item) => {
        const candidate = record(item);
        if (
          !Array.isArray(candidate?.dimensions) ||
          candidate.dimensions.length > 20
        ) {
          return [];
        }
        const rowDimensions = candidate.dimensions.flatMap((entry) => {
          const pair = record(entry);
          const dimension = shortString(pair?.dimension, 120);
          return dimension && typeof pair?.value === "string"
            ? [{ dimension, value: pair.value.slice(0, 500) }]
            : [];
        });
        const values = metricValues(candidate.values);
        return rowDimensions.length === candidate.dimensions.length && values
          ? [{ dimensions: rowDimensions, values }]
          : [];
      })
    : undefined;
  const series = Array.isArray(body.series)
    ? body.series.slice(0, 12).flatMap((item) => {
        const candidate = record(item);
        const id = shortString(candidate?.id, 120);
        const metric = shortString(candidate?.metric, 120);
        const label = shortString(candidate?.label, 160);
        if (!id || !metric || !label || !Array.isArray(candidate?.points)) {
          return [];
        }
        const points = candidate.points.slice(0, 370).flatMap((point) => {
          const pair = record(point);
          const x = shortString(pair?.x, 80);
          return x &&
            typeof pair?.value === "number" &&
            Number.isFinite(pair.value)
            ? [{ x, value: pair.value }]
            : [];
        });
        return points.length === candidate.points.length
          ? [{ id, metric, label, points }]
          : [];
      })
    : undefined;
  const charts = Array.isArray(body.charts)
    ? body.charts.slice(0, 8).flatMap((item) => {
        const candidate = record(item);
        const title = shortString(candidate?.title, 160);
        const yLabel = shortString(candidate?.yLabel, 80);
        const chartSeries = Array.isArray(candidate?.series)
          ? candidate.series.slice(0, 4).flatMap((id) => {
              const value = shortString(id, 120);
              return value ? [value] : [];
            })
          : [];
        return candidate?.kind === "line" &&
          title &&
          yLabel &&
          chartSeries.length
          ? [
              {
                kind: "line" as const,
                title,
                ...(shortString(candidate.subtitle, 240)
                  ? { subtitle: shortString(candidate.subtitle, 240) }
                  : {}),
                ...(shortString(candidate.xLabel, 80)
                  ? { xLabel: shortString(candidate.xLabel, 80) }
                  : {}),
                yLabel,
                series: chartSeries,
              },
            ]
          : [];
      })
    : undefined;
  const provenanceInput = record(body.provenance);
  const query = Array.isArray(provenanceInput?.query)
    ? provenanceInput.query.slice(0, 40).flatMap((item) => {
        const pair = record(item);
        const queryKey = shortString(pair?.key, 120);
        return queryKey && typeof pair?.value === "string"
          ? [{ key: queryKey, value: pair.value.slice(0, 1000) }]
          : [];
      })
    : undefined;
  const provenance = provenanceInput
    ? {
        ...(shortString(provenanceInput.operation, 240)
          ? { operation: shortString(provenanceInput.operation, 240) }
          : {}),
        ...(query ? { query } : {}),
        ...(shortString(provenanceInput.notes, 2000)
          ? { notes: shortString(provenanceInput.notes, 2000) }
          : {}),
      }
    : undefined;

  if (
    (Array.isArray(body.rows) && rows?.length !== body.rows.length) ||
    (Array.isArray(body.series) && series?.length !== body.series.length) ||
    (Array.isArray(body.charts) && charts?.length !== body.charts.length) ||
    (Array.isArray(provenanceInput?.query) &&
      query?.length !== provenanceInput.query.length)
  ) {
    return null;
  }

  const metricKeys = new Set(metrics.map((metric) => metric.key));
  const dimensionKeys = new Set(dimensions.map((dimension) => dimension.key));
  const seriesIds = new Set(series?.map((item) => item.id) ?? []);
  const valuesExist = (values: { metric: string }[]) =>
    values.every((value) => metricKeys.has(value.metric));
  if (
    metricKeys.size !== metrics.length ||
    dimensionKeys.size !== dimensions.length ||
    new Set(periods.map((period) => period.key)).size !== periods.length ||
    !periods.every((period) => valuesExist(period.values)) ||
    !(
      rows?.every(
        (row) =>
          row.dimensions.every((dimension) =>
            dimensionKeys.has(dimension.dimension),
          ) && valuesExist(row.values),
      ) ?? true
    ) ||
    !(series?.every((item) => metricKeys.has(item.metric)) ?? true) ||
    seriesIds.size !== (series?.length ?? 0) ||
    !(
      charts?.every((item) => item.series.every((id) => seriesIds.has(id))) ??
      true
    )
  ) {
    return null;
  }

  return {
    provider: canonicalProvider(provider),
    key,
    ...(shortString(body.sourceId, 240)
      ? { sourceId: shortString(body.sourceId, 240) }
      : {}),
    title,
    ...(shortString(body.description, 2000)
      ? { description: shortString(body.description, 2000) }
      : {}),
    metrics,
    dimensions,
    periods,
    ...(rows ? { rows } : {}),
    ...(series ? { series } : {}),
    ...(charts ? { charts } : {}),
    ...(provenance ? { provenance } : {}),
  };
}

export const listAnalyticsDatasets = httpAction(async (ctx, request) => {
  const organizationId = await organizationFromRequest(ctx, request);
  if (!organizationId) return json({ error: "Unauthorized" }, { status: 401 });
  return json({ datasets: [], storage: "local-only" });
});

export const saveAnalyticsDatasetHttp = httpAction(async (ctx, request) => {
  const organizationId = await organizationFromRequest(ctx, request);
  if (!organizationId) return json({ error: "Unauthorized" }, { status: 401 });
  const dataset = analyticsDatasetBody(await requestBody(request));
  if (!dataset) {
    return json(
      { error: "A valid bounded analytics dataset is required." },
      { status: 400 },
    );
  }
  return json(
    {
      error: "Analytics datasets are stored only by Chief's local runtime.",
    },
    { status: 410 },
  );
});

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
