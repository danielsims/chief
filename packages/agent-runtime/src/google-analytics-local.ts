import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

interface AuthorizedUserCredentials {
  type: "authorized_user";
  client_id: string;
  client_secret: string;
  refresh_token: string;
  quota_project_id?: string;
}

interface AccessTokenCache {
  value: string;
  expiresAt: number;
  quotaProjectId?: string;
}

let tokenCache: AccessTokenCache | null = null;

function adcPath() {
  return (
    process.env.GOOGLE_APPLICATION_CREDENTIALS ??
    join(homedir(), ".config", "gcloud", "application_default_credentials.json")
  );
}

async function authorizedUserCredentials(): Promise<AuthorizedUserCredentials> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(adcPath(), "utf8"));
  } catch {
    throw new Error(
      "Google Analytics machine credentials were not found. Reconnect Google Analytics in setup.",
    );
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as Record<string, unknown>).type !== "authorized_user"
  ) {
    throw new Error(
      "Google Analytics machine credentials must use an authorized user login.",
    );
  }
  const record = parsed as Record<string, unknown>;
  for (const key of ["client_id", "client_secret", "refresh_token"] as const) {
    if (typeof record[key] !== "string" || !record[key]) {
      throw new Error(
        `Google Analytics machine credentials are missing ${key}.`,
      );
    }
  }
  return record as unknown as AuthorizedUserCredentials;
}

async function accessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache;
  }
  const credentials = await authorizedUserCredentials();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      refresh_token: credentials.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!response.ok || !body.access_token) {
    if (body.error_description?.includes("invalid_rapt")) {
      throw new Error(
        "Google Analytics needs to be reconnected on this Mac before live reports can run.",
      );
    }
    throw new Error(
      body.error_description ||
        `Google Analytics machine login failed (${response.status}).`,
    );
  }
  tokenCache = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    quotaProjectId: credentials.quota_project_id,
  };
  return tokenCache;
}

function propertyId(value: unknown) {
  const result = String(value ?? "")
    .replace(/^properties\//, "")
    .trim();
  if (!/^\d{4,30}$/.test(result)) {
    throw new Error("propertyId must be a Google Analytics property number.");
  }
  return result;
}

function fieldNames(value: unknown, name: string, maximum: number) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${name} must contain at least one GA4 API field name.`);
  }
  const fields = [...new Set(value.map(String))].slice(0, maximum);
  if (fields.some((field) => !/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(field))) {
    throw new Error(`${name} contains an invalid GA4 API field name.`);
  }
  return fields;
}

function dateValue(value: unknown, name: string) {
  const result = String(value ?? "").trim();
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result) &&
    !/^(today|yesterday|\d{1,4}daysAgo)$/.test(result)
  ) {
    throw new Error(`${name} must be YYYY-MM-DD or a GA4 relative date.`);
  }
  return result;
}

async function googleRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const token = await accessToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token.value}`,
      "Content-Type": "application/json",
      ...(token.quotaProjectId
        ? { "x-goog-user-project": token.quotaProjectId }
        : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      message = parsed.error?.message ?? text;
    } catch {
      // Keep Google's plain-text response.
    }
    throw new Error(
      `Google Analytics request failed: ${message.slice(0, 500)}`,
    );
  }
  return JSON.parse(text) as T;
}

export async function googleAnalyticsMetadata(input: {
  propertyId: unknown;
  query?: unknown;
}) {
  const id = propertyId(input.propertyId);
  const result = await googleRequest<{
    dimensions?: {
      apiName?: string;
      uiName?: string;
      description?: string;
      category?: string;
      deprecatedApiNames?: string[];
    }[];
    metrics?: {
      apiName?: string;
      uiName?: string;
      description?: string;
      category?: string;
      type?: string;
      deprecatedApiNames?: string[];
    }[];
  }>(`https://analyticsdata.googleapis.com/v1beta/properties/${id}/metadata`);
  const query = String(input.query ?? "")
    .trim()
    .toLowerCase();
  const conceptAliases: Record<string, string[]> = {
    acquisition: [
      "channel group",
      "source",
      "medium",
      "campaign",
      "first user",
      "session",
    ],
    conversion: ["key event", "conversion", "purchase", "revenue"],
    engagement: ["engaged", "engagement", "session duration", "views"],
    landing: ["landing page", "page path", "page location"],
    revenue: ["revenue", "purchase", "transaction", "ecommerce"],
  };
  const preferredByConcept: Record<string, string[]> = {
    acquisition: [
      "sessionDefaultChannelGroup",
      "sessionSourceMedium",
      "sessionSource",
      "sessionMedium",
      "sessionCampaignName",
      "firstUserDefaultChannelGroup",
      "firstUserSourceMedium",
      "sessions",
      "newUsers",
      "engagedSessions",
      "engagementRate",
      "keyEvents",
      "totalRevenue",
    ],
    conversion: [
      "keyEvents",
      "sessionKeyEventRate",
      "userKeyEventRate",
      "purchaseRevenue",
      "totalRevenue",
    ],
    engagement: [
      "engagedSessions",
      "engagementRate",
      "averageSessionDuration",
      "screenPageViewsPerSession",
    ],
    landing: [
      "landingPagePlusQueryString",
      "pagePathPlusQueryString",
      "pageTitle",
      "sessions",
      "activeUsers",
      "engagedSessions",
    ],
  };
  const preferred = Object.entries(preferredByConcept).flatMap(
    ([concept, fields]) => (query.includes(concept) ? fields : []),
  );
  const terms = [
    query,
    ...Object.entries(conceptAliases).flatMap(([concept, aliases]) =>
      query.includes(concept) ? aliases : [],
    ),
  ].filter(Boolean);
  const matches = (candidate: {
    apiName?: string;
    uiName?: string;
    description?: string;
    category?: string;
  }) =>
    terms.length === 0 ||
    [
      candidate.apiName,
      candidate.uiName,
      candidate.description,
      candidate.category,
    ]
      .filter(Boolean)
      .some((value) => {
        const text = value!.toLowerCase();
        return terms.some((term) => text.includes(term));
      });
  const compact = <T extends { apiName?: string }>(items: T[] | undefined) =>
    (items ?? [])
      .filter((item) => item.apiName && matches(item))
      .sort((a, b) => {
        const aIndex = preferred.indexOf(a.apiName!);
        const bIndex = preferred.indexOf(b.apiName!);
        if (aIndex < 0 && bIndex < 0) return 0;
        if (aIndex < 0) return 1;
        if (bIndex < 0) return -1;
        return aIndex - bIndex;
      })
      .slice(0, 150)
      .map((item) => ({
        apiName: item.apiName,
        uiName: "uiName" in item ? item.uiName : undefined,
        category: "category" in item ? item.category : undefined,
        description: "description" in item ? item.description : undefined,
      }));
  return {
    propertyId: id,
    query: query || null,
    dimensions: compact(result.dimensions),
    metrics: compact(result.metrics),
  };
}

export async function googleAnalyticsProperties() {
  const result = await googleRequest<{
    accountSummaries?: {
      account?: string;
      displayName?: string;
      propertySummaries?: {
        property?: string;
        displayName?: string;
        propertyType?: string;
      }[];
    }[];
  }>(
    "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200",
  );
  return {
    provider: "google-analytics",
    mode: "live-machine",
    properties: (result.accountSummaries ?? []).flatMap((account) =>
      (account.propertySummaries ?? []).flatMap((property) => {
        const id = property.property?.replace(/^properties\//, "");
        return id
          ? [
              {
                propertyId: id,
                propertyName: property.displayName ?? `GA4 property ${id}`,
                accountName: account.displayName ?? account.account,
                propertyType: property.propertyType,
              },
            ]
          : [];
      }),
    ),
  };
}

export async function googleAnalyticsRunReport(input: {
  propertyId: unknown;
  startDate: unknown;
  endDate: unknown;
  metrics: unknown;
  dimensions?: unknown;
  limit?: unknown;
}) {
  const id = propertyId(input.propertyId);
  const metrics = fieldNames(input.metrics, "metrics", 10);
  const dimensions =
    input.dimensions === undefined
      ? []
      : fieldNames(input.dimensions, "dimensions", 9);
  const startDate = dateValue(input.startDate, "startDate");
  const endDate = dateValue(input.endDate, "endDate");
  const parsedLimit = Number(input.limit ?? 100);
  if (
    !Number.isInteger(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > 10_000
  ) {
    throw new Error("limit must be an integer from 1 to 10000.");
  }
  const result = await googleRequest<{
    dimensionHeaders?: { name?: string }[];
    metricHeaders?: { name?: string; type?: string }[];
    rows?: {
      dimensionValues?: { value?: string }[];
      metricValues?: { value?: string }[];
    }[];
    rowCount?: number;
    metadata?: Record<string, unknown>;
  }>(`https://analyticsdata.googleapis.com/v1beta/properties/${id}:runReport`, {
    method: "POST",
    body: JSON.stringify({
      dateRanges: [{ startDate, endDate }],
      metrics: metrics.map((name) => ({ name })),
      dimensions: dimensions.map((name) => ({ name })),
      limit: parsedLimit,
      keepEmptyRows: false,
      returnPropertyQuota: false,
    }),
  });
  const dimensionNames = (result.dimensionHeaders ?? []).map(
    (header) => header.name ?? "dimension",
  );
  const metricNames = (result.metricHeaders ?? []).map(
    (header) => header.name ?? "metric",
  );
  const rows = (result.rows ?? []).map((row) => {
    const normalized: Record<string, string | number> = {};
    dimensionNames.forEach((name, index) => {
      normalized[name] = row.dimensionValues?.[index]?.value ?? "";
    });
    metricNames.forEach((name, index) => {
      const raw = row.metricValues?.[index]?.value ?? "0";
      const numeric = Number(raw);
      normalized[name] = Number.isFinite(numeric) ? numeric : raw;
    });
    return normalized;
  });
  return {
    provider: "google-analytics",
    mode: "live-machine",
    source: { provider: "google-analytics", mode: "live-machine" },
    range: { startDate, endDate },
    columns: [
      ...dimensions.map((name) => ({ kind: "dimension", name })),
      ...metrics.map((name) => ({ kind: "metric", name })),
    ],
    propertyId: id,
    startDate,
    endDate,
    metrics,
    dimensions,
    rowCount: result.rowCount ?? rows.length,
    rows,
  };
}
