import { isJsonObject } from "@chief/relay-contracts";

export const GOOGLE_ANALYTICS_INTEGRATION = "google_analytics";
export const GOOGLE_ANALYTICS_CONNECTION = "main";
export const GOOGLE_ANALYTICS_OAUTH_CLIENT = "chief_google_analytics";
export const GOOGLE_ANALYTICS_AUTH_TEMPLATE = "google-analytics";
const GOOGLE_ANALYTICS_SCOPE =
  "https://www.googleapis.com/auth/analytics.readonly";
export const GOOGLE_ANALYTICS_OPENAPI_URL =
  "https://api.apis.guru/v2/specs/googleapis.com/analyticsdata/v1beta/openapi.json";

export function googleAnalyticsSpecOverrides() {
  return [
    {
      op: "add",
      path: "/paths/~1v1beta~1accountSummaries",
      value: {
        get: {
          operationId: "accountSummariesList",
          "x-executor-toolPath": "accountSummaries.list",
          servers: [{ url: "https://analyticsadmin.googleapis.com" }],
          parameters: [
            {
              name: "pageSize",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 200 },
            },
            {
              name: "pageToken",
              in: "query",
              required: false,
              schema: { type: "string" },
            },
          ],
          responses: {
            200: {
              description:
                "Accessible Google Analytics accounts and properties",
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
  ];
}

/** Repairs reserved Google resource names lost by the APIs.guru conversion. */
export function prepareGoogleAnalyticsSpec(source: unknown) {
  if (!source || !isJsonObject(source)) {
    throw new Error("Google Analytics returned an invalid OpenAPI document.");
  }
  const spec = structuredClone(source) as Record<string, unknown>;
  const paths =
    spec.paths && isJsonObject(spec.paths)
      ? (spec.paths as Record<string, Record<string, unknown>>)
      : {};
  spec.paths = paths;
  for (const pathItem of Object.values(paths)) {
    for (const operation of [pathItem, ...Object.values(pathItem)]) {
      if (!operation || !isJsonObject(operation)) continue;
      const parameters = (operation as { parameters?: unknown }).parameters;
      if (!Array.isArray(parameters)) continue;
      for (const parameter of parameters) {
        if (
          parameter &&
          isJsonObject(parameter) &&
          (parameter as { in?: unknown }).in === "path"
        ) {
          (parameter as { allowReserved?: boolean }).allowReserved = true;
        }
      }
    }
  }
  const accountSummaries = googleAnalyticsSpecOverrides()[0];
  if (!accountSummaries) {
    throw new Error("Google Analytics account discovery is unavailable.");
  }
  paths["/v1beta/accountSummaries"] = accountSummaries.value;
  return spec;
}

export const googleAnalyticsAuthentication = [
  {
    slug: GOOGLE_ANALYTICS_AUTH_TEMPLATE,
    kind: "oauth2",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [GOOGLE_ANALYTICS_SCOPE],
  },
];
