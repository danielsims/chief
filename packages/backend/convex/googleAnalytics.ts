import { v } from "convex/values";
import {
  action,
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { requireOrganizationId } from "./lib/auth";

const PROVIDER = "google-analytics";
const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function optionalEnv(name: string): string | null {
  return process.env[name] ?? null;
}

function defaultRedirectUri(): string | null {
  // CONVEX_SITE_URL is provided by the Convex runtime for every deployment,
  // so the callback URL can always be derived without manual configuration.
  const siteUrl = optionalEnv("CONVEX_SITE_URL");
  return siteUrl ? `${siteUrl}/google-analytics/callback` : null;
}

function googleOAuthConfig() {
  return {
    clientId:
      optionalEnv("GOOGLE_ANALYTICS_CLIENT_ID") ??
      optionalEnv("AUTH_GOOGLE_ID"),
    clientSecret:
      optionalEnv("GOOGLE_ANALYTICS_CLIENT_SECRET") ??
      optionalEnv("AUTH_GOOGLE_SECRET"),
    redirectUri:
      optionalEnv("GOOGLE_ANALYTICS_REDIRECT_URI") ?? defaultRedirectUri(),
  };
}

const OAUTH_STATE_TTL_MS = 30 * 60 * 1000;

function randomState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${text}`);
  }
  return JSON.parse(text) as T;
}

async function getFirstAnalyticsProperty(accessToken: string): Promise<{
  propertyId?: string;
  propertyName?: string;
  accountName?: string;
}> {
  const response = await fetch(
    "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!response.ok) return {};
  const data = (await response.json()) as {
    accountSummaries?: Array<{
      displayName?: string;
      propertySummaries?: Array<{ property?: string; displayName?: string }>;
    }>;
  };

  for (const account of data.accountSummaries ?? []) {
    const property = account.propertySummaries?.[0];
    const id = property?.property?.replace(/^properties\//, "");
    if (id) {
      return {
        propertyId: id,
        propertyName: property?.displayName,
        accountName: account.displayName,
      };
    }
  }
  return {};
}

export const startOAuth = mutation({
  args: {},
  handler: async (ctx) => {
    const organizationId = await requireOrganizationId(ctx);
    const config = googleOAuthConfig();

    if (!config.clientId || !config.clientSecret || !config.redirectUri) {
      return {
        status: "configurationRequired" as const,
        missing: [
          !config.clientId ? "GOOGLE_ANALYTICS_CLIENT_ID" : null,
          !config.clientSecret ? "GOOGLE_ANALYTICS_CLIENT_SECRET" : null,
          !config.redirectUri ? "GOOGLE_ANALYTICS_REDIRECT_URI" : null,
        ].filter((item): item is string => Boolean(item)),
      };
    }

    const state = randomState();
    await ctx.db.insert("oauthState", {
      state,
      organizationId,
      provider: PROVIDER,
      createdAt: Date.now(),
      status: "pending",
    });

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", ANALYTICS_SCOPE);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);

    return { status: "ready" as const, url: url.toString() };
  },
});

export const oauthConfigStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireOrganizationId(ctx);
    const config = googleOAuthConfig();

    return {
      configured: Boolean(
        config.clientId && config.clientSecret && config.redirectUri,
      ),
      source:
        config.clientId && config.clientSecret && config.redirectUri
          ? ("environment" as const)
          : ("none" as const),
      hasClientId: Boolean(config.clientId),
      hasClientSecret: Boolean(config.clientSecret),
      redirectUri: config.redirectUri,
      missing: [
        !config.clientId ? "GOOGLE_ANALYTICS_CLIENT_ID" : null,
        !config.clientSecret ? "GOOGLE_ANALYTICS_CLIENT_SECRET" : null,
        !config.redirectUri ? "GOOGLE_ANALYTICS_REDIRECT_URI" : null,
      ].filter((item): item is string => Boolean(item)),
    };
  },
});

export const connectionStatus = query({
  args: {},
  handler: async (ctx) => {
    const organizationId = await requireOrganizationId(ctx);
    const channel = await ctx.db
      .query("channel")
      .withIndex("by_organization_provider", (q) =>
        q.eq("organizationId", organizationId).eq("provider", PROVIDER),
      )
      .unique();
    const credential = await ctx.db
      .query("credential")
      .withIndex("by_organization_provider", (q) =>
        q.eq("organizationId", organizationId).eq("provider", PROVIDER),
      )
      .unique();

    return { channel, credential };
  },
});

export const saveProperty = mutation({
  args: {
    propertyId: v.string(),
    propertyName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const organizationId = await requireOrganizationId(ctx);
    const now = Date.now();
    const displayName =
      args.propertyName?.trim() || `GA4 property ${args.propertyId.trim()}`;
    const existing = await ctx.db
      .query("channel")
      .withIndex("by_organization_provider", (q) =>
        q.eq("organizationId", organizationId).eq("provider", PROVIDER),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        displayName,
        status: "connected",
        category: "analytics",
        externalId: args.propertyId.trim(),
        connectedAt: existing.connectedAt ?? now,
        error: undefined,
      });
      return existing._id;
    }

    return ctx.db.insert("channel", {
      organizationId,
      provider: PROVIDER,
      category: "analytics",
      displayName,
      status: "connected",
      externalId: args.propertyId.trim(),
      connectedAt: now,
    });
  },
});

export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const organizationId = await requireOrganizationId(ctx);
    const channel = await ctx.db
      .query("channel")
      .withIndex("by_organization_provider", (q) =>
        q.eq("organizationId", organizationId).eq("provider", PROVIDER),
      )
      .unique();
    if (channel) {
      await ctx.db.patch(channel._id, {
        status: "disconnected",
        error: undefined,
      });
    }
    const credential = await ctx.db
      .query("credential")
      .withIndex("by_organization_provider", (q) =>
        q.eq("organizationId", organizationId).eq("provider", PROVIDER),
      )
      .unique();
    if (credential) await ctx.db.delete(credential._id);
  },
});

export const getOAuthState = internalQuery({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("oauthState")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
  },
});

export const getCredential = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("credential")
      .withIndex("by_organization_provider", (q) =>
        q.eq("organizationId", args.organizationId).eq("provider", PROVIDER),
      )
      .unique();
  },
});

export const completeOAuth = internalMutation({
  args: {
    state: v.string(),
    organizationId: v.string(),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    scope: v.optional(v.string()),
    propertyId: v.optional(v.string()),
    propertyName: v.optional(v.string()),
    accountName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const credential = await ctx.db
      .query("credential")
      .withIndex("by_organization_provider", (q) =>
        q.eq("organizationId", args.organizationId).eq("provider", PROVIDER),
      )
      .unique();

    if (credential) {
      await ctx.db.patch(credential._id, {
        accessToken: args.accessToken,
        refreshToken: args.refreshToken ?? credential.refreshToken,
        expiresAt: args.expiresAt,
        scope: args.scope,
        externalId: args.propertyId,
        externalName: args.propertyName,
        accountName: args.accountName,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("credential", {
        provider: PROVIDER,
        organizationId: args.organizationId,
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        expiresAt: args.expiresAt,
        scope: args.scope,
        externalId: args.propertyId,
        externalName: args.propertyName,
        accountName: args.accountName,
        createdAt: now,
        updatedAt: now,
      });
    }

    const channel = await ctx.db
      .query("channel")
      .withIndex("by_organization_provider", (q) =>
        q.eq("organizationId", args.organizationId).eq("provider", PROVIDER),
      )
      .unique();
    const displayName =
      args.propertyName ??
      args.accountName ??
      (args.propertyId
        ? `GA4 property ${args.propertyId}`
        : "Google Analytics");

    if (channel) {
      await ctx.db.patch(channel._id, {
        displayName,
        status: "connected",
        category: "analytics",
        externalId: args.propertyId,
        connectedAt: channel.connectedAt ?? now,
        error: undefined,
      });
    } else {
      await ctx.db.insert("channel", {
        organizationId: args.organizationId,
        provider: PROVIDER,
        category: "analytics",
        displayName,
        status: "connected",
        externalId: args.propertyId,
        connectedAt: now,
      });
    }

    const oauthState = await ctx.db
      .query("oauthState")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (oauthState) {
      await ctx.db.patch(oauthState._id, {
        consumedAt: now,
        status: "connected",
      });
    }
  },
});

export const markOAuthError = internalMutation({
  args: { state: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const oauthState = await ctx.db
      .query("oauthState")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (oauthState) {
      await ctx.db.patch(oauthState._id, {
        consumedAt: Date.now(),
        status: "error",
        error: args.error,
      });
    }
  },
});

export const refreshCredential = internalMutation({
  args: {
    organizationId: v.string(),
    accessToken: v.string(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const credential = await ctx.db
      .query("credential")
      .withIndex("by_organization_provider", (q) =>
        q.eq("organizationId", args.organizationId).eq("provider", PROVIDER),
      )
      .unique();
    if (credential) {
      await ctx.db.patch(credential._id, {
        accessToken: args.accessToken,
        expiresAt: args.expiresAt,
        updatedAt: Date.now(),
      });
    }
  },
});

export const markSynced = internalMutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const channel = await ctx.db
      .query("channel")
      .withIndex("by_organization_provider", (q) =>
        q.eq("organizationId", args.organizationId).eq("provider", PROVIDER),
      )
      .unique();
    if (channel) {
      await ctx.db.patch(channel._id, { lastSyncAt: Date.now() });
    }
  },
});

export const oauthCallback = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (!state) {
    return jsonResponse({ error: "Missing state" }, { status: 400 });
  }

  if (error) {
    await ctx.runMutation(internal.googleAnalytics.markOAuthError, {
      state,
      error,
    });
    return new Response("Google Analytics connection was canceled.", {
      status: 200,
    });
  }

  if (!code) {
    return jsonResponse({ error: "Missing code" }, { status: 400 });
  }

  const oauthState = await ctx.runQuery(
    internal.googleAnalytics.getOAuthState,
    {
      state,
    },
  );
  if (
    !oauthState ||
    oauthState.status !== "pending" ||
    Date.now() - oauthState.createdAt > OAUTH_STATE_TTL_MS
  ) {
    return jsonResponse({ error: "Invalid OAuth state" }, { status: 400 });
  }

  try {
    const config = googleOAuthConfig();
    const clientId =
      config.clientId ?? requiredEnv("GOOGLE_ANALYTICS_CLIENT_ID");
    const clientSecret =
      config.clientSecret ?? requiredEnv("GOOGLE_ANALYTICS_CLIENT_SECRET");
    const redirectUri =
      config.redirectUri ?? requiredEnv("GOOGLE_ANALYTICS_REDIRECT_URI");

    const token = await fetchJson<{
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    }>("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const property = await getFirstAnalyticsProperty(token.access_token);
    await ctx.runMutation(internal.googleAnalytics.completeOAuth, {
      state,
      organizationId: oauthState.organizationId,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in
        ? Date.now() + token.expires_in * 1000
        : undefined,
      scope: token.scope,
      ...property,
    });

    return new Response(
      "Google Analytics is connected. You can return to Marketer.",
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.runMutation(internal.googleAnalytics.markOAuthError, {
      state,
      error: message,
    });
    return jsonResponse({ error: message }, { status: 500 });
  }
});

async function accessTokenForOrganization(
  ctx: ActionCtx,
  organizationId: string,
): Promise<{ accessToken: string; propertyId?: string } | null> {
  const credential = await ctx.runQuery(
    internal.googleAnalytics.getCredential,
    {
      organizationId,
    },
  );
  if (!credential) return null;

  if (
    credential.refreshToken &&
    credential.expiresAt &&
    credential.expiresAt < Date.now() + 60_000
  ) {
    const config = googleOAuthConfig();
    const refreshed = await fetchJson<{
      access_token: string;
      expires_in?: number;
    }>("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId ?? requiredEnv("GOOGLE_ANALYTICS_CLIENT_ID"),
        client_secret:
          config.clientSecret ?? requiredEnv("GOOGLE_ANALYTICS_CLIENT_SECRET"),
        refresh_token: credential.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    await ctx.runMutation(internal.googleAnalytics.refreshCredential, {
      organizationId,
      accessToken: refreshed.access_token,
      expiresAt: refreshed.expires_in
        ? Date.now() + refreshed.expires_in * 1000
        : undefined,
    });
    return {
      accessToken: refreshed.access_token,
      propertyId: credential.externalId,
    };
  }

  return {
    accessToken: credential.accessToken,
    propertyId: credential.externalId,
  };
}

export const summary = action({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const organizationId = identity?.organizationId as string | undefined;
    if (!identity || !organizationId) {
      throw new Error("No active workspace. Sign out and back in.");
    }
    const token = await accessTokenForOrganization(ctx, organizationId);
    if (!token?.accessToken || !token.propertyId) return null;

    const data = await fetchJson<{
      rows?: Array<{
        metricValues?: Array<{ value?: string }>;
      }>;
    }>(
      `https://analyticsdata.googleapis.com/v1beta/properties/${token.propertyId}:runReport`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
          metrics: [
            { name: "activeUsers" },
            { name: "sessions" },
            { name: "screenPageViews" },
            { name: "conversions" },
            { name: "totalRevenue" },
          ],
        }),
      },
    );

    await ctx.runMutation(internal.googleAnalytics.markSynced, {
      organizationId,
    });

    const values = data.rows?.[0]?.metricValues ?? [];
    return {
      activeUsers: Number(values[0]?.value ?? 0),
      sessions: Number(values[1]?.value ?? 0),
      pageViews: Number(values[2]?.value ?? 0),
      conversions: Number(values[3]?.value ?? 0),
      revenue: Number(values[4]?.value ?? 0),
      period: "30 D",
    };
  },
});

const REPORT_METRICS = new Set([
  "activeUsers",
  "newUsers",
  "sessions",
  "engagedSessions",
  "screenPageViews",
  "eventCount",
  "keyEvents",
  "totalRevenue",
  "userEngagementDuration",
]);

const REPORT_DIMENSIONS = new Set([
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
]);

/**
 * Authenticated capability endpoint used by the local MCP adapter. It keeps
 * provider credentials in Convex while returning a portable row model.
 */
export const runReport = action({
  args: {
    startDate: v.string(),
    endDate: v.string(),
    metrics: v.array(v.string()),
    dimensions: v.array(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, args): Promise<ReportResult> => {
    const identity = await ctx.auth.getUserIdentity();
    const organizationId = identity?.organizationId as string | undefined;
    if (!identity || !organizationId) {
      throw new Error("No active workspace. Sign out and back in.");
    }
    return executeReport(ctx, organizationId, args);
  },
});

type ReportArgs = {
  startDate: string;
  endDate: string;
  metrics: string[];
  dimensions: string[];
  limit: number;
};

type ReportResult = {
  source: {
    provider: string;
    id: string | null;
    mode?: "cached-snapshot";
    capturedAt?: number;
  };
  range: { startDate: string; endDate: string };
  columns: Array<{ name: string; kind: string; type?: string }>;
  rows: Array<Record<string, string | number>>;
  rowCount: number;
};

function compactDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function shiftCompactDate(value: string, days: number): string {
  const date = new Date(
    Date.UTC(
      Number(value.slice(0, 4)),
      Number(value.slice(4, 6)) - 1,
      Number(value.slice(6, 8)),
    ),
  );
  date.setUTCDate(date.getUTCDate() + days);
  return compactDate(date);
}

function resolveSnapshotDate(value: string, latest: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replace(/-/g, "");
  if (/^\d{8}$/.test(value)) return value;
  if (value === "today") return latest;
  if (value === "yesterday") return shiftCompactDate(latest, -1);
  const relative = /^(\d+)daysAgo$/.exec(value);
  if (relative) return shiftCompactDate(latest, -Number(relative[1]));
  throw new Error(`Unsupported date: ${value}`);
}

async function reportFromSnapshot(
  ctx: ActionCtx,
  organizationId: string,
  args: ReportArgs,
): Promise<ReportResult | null> {
  const snapshot = (await ctx.runQuery(
    internal.analyticsSnapshots.getForOrganization,
    { organizationId, provider: PROVIDER },
  )) as {
    series?: Array<{ date: string; value: number }>;
    capturedAt: number;
  } | null;
  const series = snapshot?.series ?? [];
  const latest = series.at(-1)?.date;
  if (!snapshot || !latest || series.length === 0) return null;
  if (
    args.metrics.some((metric) => metric !== "activeUsers") ||
    args.dimensions.some((dimension) => dimension !== "date")
  ) {
    throw new Error(
      "This workspace currently has cached daily activeUsers data. Connect Google Analytics in integration settings for live reports with additional metrics or dimensions.",
    );
  }

  const startDate = resolveSnapshotDate(args.startDate, latest);
  const endDate = resolveSnapshotDate(args.endDate, latest);
  const points = series
    .filter((point) => point.date >= startDate && point.date <= endDate)
    .slice(0, Math.max(1, Math.min(Math.trunc(args.limit), 10_000)));
  const rows = args.dimensions.includes("date")
    ? points.map((point) => ({ date: point.date, activeUsers: point.value }))
    : [
        {
          activeUsers: points.reduce((total, point) => total + point.value, 0),
        },
      ];
  return {
    source: {
      provider: PROVIDER,
      id: null,
      mode: "cached-snapshot",
      capturedAt: snapshot.capturedAt,
    },
    range: { startDate: args.startDate, endDate: args.endDate },
    columns: [
      ...(args.dimensions.includes("date")
        ? [{ name: "date", kind: "dimension" }]
        : []),
      { name: "activeUsers", kind: "metric", type: "TYPE_INTEGER" },
    ],
    rows,
    rowCount: rows.length,
  };
}

async function executeReport(
  ctx: ActionCtx,
  organizationId: string,
  args: ReportArgs,
): Promise<ReportResult> {
  if (args.metrics.length === 0) throw new Error("Choose at least one metric.");
  for (const metric of args.metrics) {
    if (!REPORT_METRICS.has(metric))
      throw new Error(`Unsupported metric: ${metric}`);
  }
  for (const dimension of args.dimensions) {
    if (!REPORT_DIMENSIONS.has(dimension)) {
      throw new Error(`Unsupported dimension: ${dimension}`);
    }
  }

  const token = await accessTokenForOrganization(ctx, organizationId);
  if (!token?.accessToken || !token.propertyId) {
    const cached = await reportFromSnapshot(ctx, organizationId, args);
    if (cached) return cached;
    throw new Error("Google Analytics is not connected to this workspace.");
  }
  const data = await fetchJson<{
    dimensionHeaders?: Array<{ name: string }>;
    metricHeaders?: Array<{ name: string; type?: string }>;
    rows?: Array<{
      dimensionValues?: Array<{ value?: string }>;
      metricValues?: Array<{ value?: string }>;
    }>;
    rowCount?: number;
  }>(
    `https://analyticsdata.googleapis.com/v1beta/properties/${token.propertyId}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: args.startDate, endDate: args.endDate }],
        metrics: args.metrics.map((name) => ({ name })),
        dimensions: args.dimensions.map((name) => ({ name })),
        limit: Math.max(1, Math.min(Math.trunc(args.limit), 10_000)),
        keepEmptyRows: false,
      }),
    },
  );

  const dimensionHeaders = (data.dimensionHeaders ?? []).map(
    (header) => header.name,
  );
  const metricHeaders = (data.metricHeaders ?? []).map((header) => ({
    name: header.name,
    type: header.type ?? "TYPE_UNSPECIFIED",
  }));
  const rows = (data.rows ?? []).map((row) => {
    const result: Record<string, string | number> = {};
    dimensionHeaders.forEach((name, index) => {
      result[name] = row.dimensionValues?.[index]?.value ?? "";
    });
    metricHeaders.forEach((header, index) => {
      const raw = row.metricValues?.[index]?.value ?? "0";
      const numeric = Number(raw);
      result[header.name] = Number.isFinite(numeric) ? numeric : raw;
    });
    return result;
  });

  await ctx.runMutation(internal.googleAnalytics.markSynced, {
    organizationId,
  });
  return {
    source: {
      provider: PROVIDER,
      id: token.propertyId,
    },
    range: { startDate: args.startDate, endDate: args.endDate },
    columns: [
      ...dimensionHeaders.map((name) => ({ name, kind: "dimension" })),
      ...metricHeaders.map((header) => ({
        name: header.name,
        kind: "metric",
        type: header.type,
      })),
    ],
    rows,
    rowCount: data.rowCount ?? rows.length,
  };
}

/** Internal entry point for the capability-authenticated Agent Tools API. */
export const runReportForOrganization = internalAction({
  args: {
    organizationId: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    metrics: v.array(v.string()),
    dimensions: v.array(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, args) =>
    executeReport(ctx, args.organizationId, {
      startDate: args.startDate,
      endDate: args.endDate,
      metrics: args.metrics,
      dimensions: args.dimensions,
      limit: args.limit,
    }),
});
