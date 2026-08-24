import type { JsonObject, JsonValue } from "@chief/relay-contracts";
import { isJsonObject } from "@chief/relay-contracts";

export const GOOGLE_ANALYTICS_INTEGRATION = "google_analytics";
export const GOOGLE_ANALYTICS_CONNECTION = "main";
export const GOOGLE_ANALYTICS_OAUTH_CLIENT = "chief_google_analytics";
export const GOOGLE_ANALYTICS_AUTH_TEMPLATE = "google-analytics";
const GOOGLE_ANALYTICS_SCOPE =
  "https://www.googleapis.com/auth/analytics.readonly";
export const GOOGLE_ANALYTICS_OPENAPI_URL =
  "https://api.apis.guru/v2/specs/googleapis.com/analyticsdata/v1beta/openapi.json";

type AccountSummariesPath = JsonObject & {
  get: JsonObject & {
    "x-executor-toolPath": string;
    servers: (JsonObject & { url: string })[];
  };
};

interface GoogleAnalyticsSpecOverride {
  op: string;
  path: string;
  value: AccountSummariesPath;
}

const accountSummariesPath: AccountSummariesPath = {
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
        description: "Accessible Google Analytics accounts and properties",
        content: {
          "application/json": {
            schema: { type: "object", additionalProperties: true },
          },
        },
      },
    },
  },
};

export function googleAnalyticsSpecOverrides(): GoogleAnalyticsSpecOverride[] {
  return [
    {
      op: "add",
      path: "/paths/~1v1beta~1accountSummaries",
      value: accountSummariesPath,
    },
  ];
}

/** Repairs reserved Google resource names lost by the APIs.guru conversion. */
export function prepareGoogleAnalyticsSpec(source: JsonValue): JsonObject {
  if (!source || !isJsonObject(source)) {
    throw new Error("Google Analytics returned an invalid OpenAPI document.");
  }
  const spec = structuredClone(source);
  const paths = isJsonObject(spec.paths) ? spec.paths : {};
  spec.paths = paths;
  for (const pathItem of Object.values(paths)) {
    if (!isJsonObject(pathItem)) continue;
    for (const operation of [pathItem, ...Object.values(pathItem)]) {
      if (!operation || !isJsonObject(operation)) continue;
      const parameters = operation.parameters;
      if (!Array.isArray(parameters)) continue;
      for (const parameter of parameters) {
        if (parameter && isJsonObject(parameter) && parameter.in === "path") {
          parameter.allowReserved = true;
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
